import db from "../utils/db.js";

export function addProduct(product) {
  return db("products").insert(product).returning("id");
}

export function addProductImages(images) {
  return db("product_images").insert(images);
}

export function updateProductThumbnail(productId, thumbnailPath) {
  return db("products")
    .where("id", productId)
    .update({ thumbnail: thumbnailPath });
}

export function updateProduct(productId, productData) {
  return db("products").where("id", productId).update(productData);
}

export function deleteProduct(productId) {
  return db("products").where("id", productId).del();
}

export async function cancelProduct(productId, sellerId) {
  // Get product to verify seller
  const product = await db("products").where("id", productId).first();

  if (!product) {
    throw new Error("Product not found");
  }

  if (product.seller_id !== sellerId) {
    throw new Error("Unauthorized");
  }

  // Cancel any active orders for this product
  const activeOrders = await db("orders")
    .where("product_id", productId)
    .whereNotIn("status", ["completed", "cancelled"]);

  // Cancel all active orders
  for (let order of activeOrders) {
    await db("orders").where("id", order.id).update({
      status: "cancelled",
      cancelled_by: sellerId,
      cancellation_reason: "Seller cancelled the product",
      cancelled_at: new Date(),
    });
  }

  // Update product - mark as cancelled
  await updateProduct(productId, {
    is_sold: false,
    closed_at: new Date(),
  });

  // Return product data for route to use
  return product;
}

/**
 * Lấy các auction vừa kết thúc mà chưa gửi thông báo
 * Điều kiện: end_at < now() AND end_notification_sent IS NULL
 * @returns {Promise<Array>} Danh sách các sản phẩm kết thúc cần gửi thông báo
 */
export async function getNewlyEndedAuctions() {
  return db("products")
    .leftJoin("users as seller", "products.seller_id", "seller.id")
    .leftJoin("users as winner", "products.highest_bidder_id", "winner.id")
    .where("products.end_at", "<", new Date())
    .whereNull("products.end_notification_sent")
    .select(
      "products.id",
      "products.name",
      "products.current_price",
      "products.highest_bidder_id",
      "products.seller_id",
      "products.end_at",
      "products.is_sold",
      "products.status",
      "seller.fullname as seller_name",
      "seller.email as seller_email",
      "winner.fullname as winner_name",
      "winner.email as winner_email",
    );
}

/**
 * Đánh dấu auction đã gửi thông báo kết thúc
 * @param {number} productId - ID sản phẩm
 */
export async function markEndNotificationSent(productId) {
  return db("products").where("id", productId).update({
    end_notification_sent: new Date(),
  });
}

import { ProductState } from "../utils/product.state.js";

/**
 * Cập nhật trạng thái sản phẩm
 * @param {number} productId ID sản phẩm
 * @param {string} newStatus Trạng thái mới
 */
export async function updateStatus(productId, newStatus) {
  const currentProduct = await db("products")
    .where("id", productId)
    .select("status")
    .first();
  if (!currentProduct) {
    throw new Error("Product not found");
  }

  if (!ProductState.isValidTransition(currentProduct.status, newStatus)) {
    throw new Error(
      `Invalid status transition from ${currentProduct.status} to ${newStatus}`,
    );
  }

  return db("products").where("id", productId).update({ status: newStatus });
}
