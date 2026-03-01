import db from '../utils/db.js';

/**
 * ============================================
 * ORDER MODEL
 * ============================================
 * Quản lý đơn hàng sau khi đấu giá kết thúc
 * 
 * Quy trình:
 * 1. pending_payment: Chờ buyer gửi chứng từ thanh toán
 * 2. payment_submitted: Buyer đã gửi chứng từ
 * 3. payment_confirmed: Seller xác nhận đã nhận tiền
 * 4. shipped: Seller đã gửi hàng
 * 5. delivered: Buyer xác nhận đã nhận hàng
 * 6. completed: Hoàn tất (đã đánh giá)
 * 7. cancelled: Đơn hàng bị hủy
 */

/**
 * Tạo order mới (thường được trigger tự động tạo)
 */
export async function createOrder(orderData) {
  const {
    product_id,
    seller_id,
    buyer_id,
    final_price,
    shipping_address,
    shipping_phone,
    shipping_note
  } = orderData;

  const rows = await db('orders').insert({
    product_id,
    seller_id,
    buyer_id,
    final_price,
    shipping_address,
    shipping_phone,
    shipping_note,
    status: 'pending_payment',
    created_at: db.fn.now()
  }).returning('*');

  return rows[0];
}

/**
 * Lấy thông tin order theo ID
 */
export async function findById(orderId) {
  return db('orders')
    .where('id', orderId)
    .first();
}

/**
 * Lấy order theo product_id
 */
export async function findByProductId(productId) {
  return db('orders')
    .where('product_id', productId)
    .first();
}



/**
 * Cập nhật trạng thái order
 */
export async function updateStatus(orderId, newStatus, userId, note = null) {
  const trx = await db.transaction();

  try {
    // Lấy trạng thái cũ
    const order = await trx('orders')
      .where('id', orderId)
      .first();

    if (!order) {
      throw new Error('Order not found');
    }

    const oldStatus = order.status;

    // Cập nhật order
    const updateData = {
      status: newStatus,
      updated_at: db.fn.now()
    };

    // Cập nhật timestamp tương ứng
    switch (newStatus) {
      case 'payment_submitted':
        updateData.payment_submitted_at = db.fn.now();
        break;
      case 'payment_confirmed':
        updateData.payment_confirmed_at = db.fn.now();
        break;
      case 'shipped':
        updateData.shipped_at = db.fn.now();
        break;
      case 'delivered':
        updateData.delivered_at = db.fn.now();
        break;
      case 'completed':
        updateData.completed_at = db.fn.now();
        break;
      case 'cancelled':
        updateData.cancelled_at = db.fn.now();
        updateData.cancelled_by = userId;
        if (note) {
          updateData.cancellation_reason = note;
        }
        break;
    }

    await trx('orders')
      .where('id', orderId)
      .update(updateData);

    // Ghi log vào order_status_history
    await trx('order_status_history').insert({
      order_id: orderId,
      from_status: oldStatus,
      to_status: newStatus,
      changed_by: userId,
      note: note,
      created_at: db.fn.now()
    });

    await trx.commit();

    return findById(orderId);
  } catch (error) {
    await trx.rollback();
    throw error;
  }
}

/**
 * Cập nhật thông tin giao hàng
 */
export async function updateShippingInfo(orderId, shippingData) {
  const {
    shipping_address,
    shipping_phone,
    shipping_note
  } = shippingData;

  const rows = await db('orders')
    .where('id', orderId)
    .update({
      shipping_address,
      shipping_phone,
      shipping_note,
      updated_at: db.fn.now()
    })
    .returning('*');

  return rows[0];
}


