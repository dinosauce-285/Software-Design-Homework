import db from "../utils/db.js";

// Seller Statistics Functions
export function countProductsBySellerId(sellerId) {
  return db("products")
    .where("seller_id", sellerId)
    .count("id as count")
    .first();
}

export function countActiveProductsBySellerId(sellerId) {
  return db("products")
    .where("seller_id", sellerId)
    .where("end_at", ">", new Date())
    .whereNull("closed_at")
    .count("id as count")
    .first();
}

export function countSoldProductsBySellerId(sellerId) {
  return db("products")
    .where("seller_id", sellerId)
    .where("end_at", "<=", new Date())
    .where("is_sold", true)
    .count("id as count")
    .first();
}

export function countPendingProductsBySellerId(sellerId) {
  return db("products")
    .where("seller_id", sellerId)
    .where(function () {
      this.where("end_at", "<=", new Date()).orWhereNotNull("closed_at");
    })
    .whereNotNull("highest_bidder_id")
    .whereNull("is_sold")
    .count("id as count")
    .first();
}

export function countExpiredProductsBySellerId(sellerId) {
  return db("products")
    .where("seller_id", sellerId)
    .where(function () {
      this.where(function () {
        this.where("end_at", "<=", new Date()).whereNull("highest_bidder_id");
      }).orWhere("is_sold", false);
    })
    .count("id as count")
    .first();
}

export async function getSellerStats(sellerId) {
  const [
    total,
    active,
    sold,
    pending,
    expired,
    pendingRevenue,
    completedRevenue,
  ] = await Promise.all([
    countProductsBySellerId(sellerId),
    countActiveProductsBySellerId(sellerId),
    countSoldProductsBySellerId(sellerId),
    countPendingProductsBySellerId(sellerId),
    countExpiredProductsBySellerId(sellerId),
    // Pending Revenue: Sản phẩm hết hạn hoặc closed, có người thắng nhưng chưa thanh toán
    db("products")
      .where("seller_id", sellerId)
      .where(function () {
        this.where("end_at", "<=", new Date()).orWhereNotNull("closed_at");
      })
      .whereNotNull("highest_bidder_id")
      .whereNull("is_sold")
      .sum("current_price as revenue")
      .first(),
    // Completed Revenue: Sản phẩm đã bán thành công
    db("products")
      .where("seller_id", sellerId)
      .where("is_sold", true)
      .sum("current_price as revenue")
      .first(),
  ]);

  const pendingRev = parseFloat(pendingRevenue.revenue) || 0;
  const completedRev = parseFloat(completedRevenue.revenue) || 0;

  return {
    total_products: parseInt(total.count) || 0,
    active_products: parseInt(active.count) || 0,
    sold_products: parseInt(sold.count) || 0,
    pending_products: parseInt(pending.count) || 0,
    expired_products: parseInt(expired.count) || 0,
    pending_revenue: pendingRev,
    completed_revenue: completedRev,
    total_revenue: pendingRev + completedRev,
  };
}

export function findAllProductsBySellerId(sellerId) {
  return db("products")
    .leftJoin("categories", "products.category_id", "categories.id")
    .where("seller_id", sellerId)
    .select(
      "products.*",
      "categories.name as category_name",
      db.raw(`
        (
          SELECT COUNT(*) 
          FROM bidding_history 
          WHERE bidding_history.product_id = products.id
        ) AS bid_count
      `),
      "products.status as status",
    );
}

export function findActiveProductsBySellerId(sellerId) {
  return db("products")
    .leftJoin("categories", "products.category_id", "categories.id")
    .where("seller_id", sellerId)
    .where("end_at", ">", new Date())
    .whereNull("closed_at")
    .select(
      "products.*",
      "categories.name as category_name",
      db.raw(`
        (
          SELECT COUNT(*) 
          FROM bidding_history 
          WHERE bidding_history.product_id = products.id
        ) AS bid_count
      `),
    );
}

export function findPendingProductsBySellerId(sellerId) {
  return db("products")
    .leftJoin("categories", "products.category_id", "categories.id")
    .leftJoin("users", "products.highest_bidder_id", "users.id")
    .where("seller_id", sellerId)
    .where(function () {
      this.where("end_at", "<=", new Date()).orWhereNotNull("closed_at");
    })
    .whereNotNull("highest_bidder_id")
    .whereNull("is_sold")
    .select(
      "products.*",
      "categories.name as category_name",
      "users.fullname as highest_bidder_name",
      "users.email as highest_bidder_email",
      db.raw(`
        (
          SELECT COUNT(*) 
          FROM bidding_history
          WHERE bidding_history.product_id = products.id
        ) AS bid_count
      `),
    );
}

export function findSoldProductsBySellerId(sellerId) {
  return db("products")
    .leftJoin("categories", "products.category_id", "categories.id")
    .leftJoin("users", "products.highest_bidder_id", "users.id")
    .where("seller_id", sellerId)
    .where("end_at", "<=", new Date())
    .where("is_sold", true)
    .select(
      "products.*",
      "categories.name as category_name",
      "users.fullname as highest_bidder_name",
      "users.email as highest_bidder_email",
      db.raw(`
        (
          SELECT COUNT(*) 
          FROM bidding_history
          WHERE bidding_history.product_id = products.id
        ) AS bid_count
      `),
    );
}

export function findExpiredProductsBySellerId(sellerId) {
  return db("products")
    .leftJoin("categories", "products.category_id", "categories.id")
    .where("seller_id", sellerId)
    .where(function () {
      this.where(function () {
        this.where("end_at", "<=", new Date()).whereNull("highest_bidder_id");
      }).orWhere("is_sold", false);
    })
    .select(
      "products.*",
      "categories.name as category_name",
      "products.status as status",
    );
}

export async function getSoldProductsStats(sellerId) {
  const result = await db("products")
    .where("seller_id", sellerId)
    .where("end_at", "<=", new Date())
    .where("is_sold", true)
    .select(
      db.raw("COUNT(products.id) as total_sold"),
      db.raw("COALESCE(SUM(products.current_price), 0) as total_revenue"),
      db.raw(`
        COALESCE(SUM((
          SELECT COUNT(*)
          FROM bidding_history
          WHERE bidding_history.product_id = products.id
        )), 0) as total_bids
      `),
    )
    .first();

  return {
    total_sold: parseInt(result.total_sold) || 0,
    total_revenue: parseFloat(result.total_revenue) || 0,
    total_bids: parseInt(result.total_bids) || 0,
  };
}

export async function getPendingProductsStats(sellerId) {
  const result = await db("products")
    .where("seller_id", sellerId)
    .where(function () {
      this.where("end_at", "<=", new Date()).orWhereNotNull("closed_at");
    })
    .whereNotNull("highest_bidder_id")
    .whereNull("is_sold")
    .select(
      db.raw("COUNT(products.id) as total_pending"),
      db.raw("COALESCE(SUM(products.current_price), 0) as pending_revenue"),
      db.raw(`
        COALESCE(SUM((
          SELECT COUNT(*)
          FROM bidding_history
          WHERE bidding_history.product_id = products.id
        )), 0) as total_bids
      `),
    )
    .first();

  return {
    total_pending: parseInt(result.total_pending) || 0,
    pending_revenue: parseFloat(result.pending_revenue) || 0,
    total_bids: parseInt(result.total_bids) || 0,
  };
}
