import db from '../utils/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ============================================
 * INVOICE MODEL
 * ============================================
 * Quản lý hóa đơn thanh toán và vận chuyển
 * 
 * 2 loại invoice:
 * - payment: Hóa đơn thanh toán từ buyer
 * - shipping: Hóa đơn vận chuyển từ seller
 */

/**
 * Move uploaded files from temp folder to permanent folder
 * @param {Array} tempUrls - Array of temp URLs like ["uploads/123.jpg"]
 * @param {String} type - 'payment_proofs' or 'shipping_proofs'
 * @returns {Array} - Array of permanent URLs like ["images/payment_proofs/123.jpg"]
 */
function moveUploadedFiles(tempUrls, type) {
  if (!tempUrls || tempUrls.length === 0) return [];

  const targetFolder = `public/images/${type}`;
  const publicPath = path.join(__dirname, '..', 'public');
  const targetPath = path.join(publicPath, 'images', type);

  // Create target folder if not exists
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }

  const permanentUrls = [];

  for (const tempUrl of tempUrls) {
    // tempUrl format: "uploads/1234567890-987654321-originalname.jpg"
    const tempFilename = path.basename(tempUrl);
    const tempPath = path.join(publicPath, tempUrl);

    // Extract extension from original filename
    const ext = path.extname(tempFilename);

    // Generate new short filename: timestamp-random.ext
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1E9);
    const newFilename = `${timestamp}-${random}${ext}`;

    const newPath = path.join(targetPath, newFilename);
    const newUrl = `images/${type}/${newFilename}`;

    try {
      // Move and rename file from temp to permanent
      if (fs.existsSync(tempPath)) {
        fs.renameSync(tempPath, newPath);
        permanentUrls.push(newUrl);
      } else {
        console.warn(`Temp file not found: ${tempPath}`);
      }
    } catch (error) {
      console.error(`Error moving file ${tempUrl}:`, error);
    }
  }

  return permanentUrls;
}

/**
 * Tạo hóa đơn thanh toán (từ buyer)
 */
export async function createPaymentInvoice(invoiceData) {
  const {
    order_id,
    issuer_id,
    payment_method,
    payment_proof_urls,
    note
  } = invoiceData;

  // Move files from uploads/ to images/payment_proofs/
  const permanentUrls = moveUploadedFiles(payment_proof_urls, 'payment_proofs');

  const rows = await db('invoices').insert({
    order_id,
    issuer_id,
    invoice_type: 'payment',
    payment_method,
    payment_proof_urls: permanentUrls,
    note,
    is_verified: false,
    created_at: db.fn.now()
  }).returning('*');

  return rows[0];
}

/**
 * Tạo hóa đơn vận chuyển (từ seller)
 */
export async function createShippingInvoice(invoiceData) {
  const {
    order_id,
    issuer_id,
    tracking_number,
    shipping_provider,
    shipping_proof_urls,
    note
  } = invoiceData;

  // Move files from uploads/ to images/shipping_proofs/
  const permanentUrls = moveUploadedFiles(shipping_proof_urls, 'shipping_proofs');

  const rows = await db('invoices').insert({
    order_id,
    issuer_id,
    invoice_type: 'shipping',
    tracking_number,
    shipping_provider,
    shipping_proof_urls: permanentUrls,
    note,
    is_verified: false,
    created_at: db.fn.now()
  }).returning('*');

  return rows[0];
}



/**
 * Lấy payment invoice của một order
 */
export async function getPaymentInvoice(orderId) {
  return db('invoices')
    .leftJoin('users as issuer', 'invoices.issuer_id', 'issuer.id')
    .where('invoices.order_id', orderId)
    .where('invoices.invoice_type', 'payment')
    .select(
      'invoices.*',
      'issuer.fullname as issuer_name'
    )
    .first();
}

/**
 * Lấy shipping invoice của một order
 */
export async function getShippingInvoice(orderId) {
  return db('invoices')
    .leftJoin('users as issuer', 'invoices.issuer_id', 'issuer.id')
    .where('invoices.order_id', orderId)
    .where('invoices.invoice_type', 'shipping')
    .select(
      'invoices.*',
      'issuer.fullname as issuer_name'
    )
    .first();
}

/**
 * Xác minh invoice
 */
export async function verifyInvoice(invoiceId) {
  const rows = await db('invoices')
    .where('id', invoiceId)
    .update({
      is_verified: true,
      verified_at: db.fn.now(),
      updated_at: db.fn.now()
    })
    .returning('*');

  return rows[0];
}


