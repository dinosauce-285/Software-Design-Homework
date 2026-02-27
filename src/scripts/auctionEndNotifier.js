/**
 * Auction End Notifier
 * Script kiểm tra và gửi email thông báo khi đấu giá kết thúc
 */

import * as productModel from "../models/product.model.js";
import { sendMail } from "../utils/mailer.js";

/**
 * Kiểm tra các đấu giá kết thúc và gửi email thông báo
 */
export async function checkAndNotifyEndedAuctions() {
  try {
    const endedAuctions = await productModel.getNewlyEndedAuctions();

    if (endedAuctions.length === 0) {
      return;
    }

    console.log(`📧 Found ${endedAuctions.length} ended auctions to notify`);

    for (const auction of endedAuctions) {
      try {
        const productUrl = `${process.env.BASE_URL || "http://localhost:3005"}/products/detail?id=${auction.id}`;

        // Có người thắng
        if (auction.highest_bidder_id) {
          // Gửi email cho người thắng
          if (auction.winner_email) {
            await sendMail({
              to: auction.winner_email,
              subject: `🎉 Congratulations! You won the auction: ${auction.name}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="color: white; margin: 0;">🎉 You Won!</h1>
                  </div>
                  <div style="background-color: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
                    <p>Dear <strong>${auction.winner_name}</strong>,</p>
                    <p>Congratulations! You have won the auction for:</p>
                    <div style="background-color: white; padding: 20px; border-radius: 10px; margin: 20px 0; border-left: 4px solid #28a745;">
                      <h3 style="margin: 0 0 10px 0; color: #333;">${auction.name}</h3>
                      <p style="font-size: 24px; color: #28a745; margin: 0; font-weight: bold;">
                        ${new Intl.NumberFormat("en-US").format(auction.current_price)} VND
                      </p>
                    </div>
                    <p>Please complete your payment to finalize the purchase.</p>
                    <div style="text-align: center; margin: 30px 0;">
                      <a href="${productUrl}" style="display: inline-block; background: linear-gradient(135deg, #28a745 0%, #218838 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">
                        Complete Payment
                      </a>
                    </div>
                    <p style="color: #666; font-size: 14px;">Please complete payment within 3 days to avoid order cancellation.</p>
                  </div>
                  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                  <p style="color: #888; font-size: 12px; text-align: center;">This is an automated message from Online Auction. Please do not reply to this email.</p>
                </div>
              `,
            });
            console.log(
              `✅ Winner notification sent to ${auction.winner_email} for product #${auction.id}`,
            );
          }

          // Gửi email cho người bán - Có người thắng
          if (auction.seller_email) {
            await sendMail({
              to: auction.seller_email,
              subject: `🔔 Auction Ended: ${auction.name} - Winner Found!`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background: linear-gradient(135deg, #72AEC8 0%, #5a9ab8 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="color: white; margin: 0;">Auction Ended</h1>
                  </div>
                  <div style="background-color: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
                    <p>Dear <strong>${auction.seller_name}</strong>,</p>
                    <p>Your auction has ended with a winner!</p>
                    <div style="background-color: white; padding: 20px; border-radius: 10px; margin: 20px 0; border-left: 4px solid #72AEC8;">
                      <h3 style="margin: 0 0 10px 0; color: #333;">${auction.name}</h3>
                      <p style="margin: 5px 0;"><strong>Winner:</strong> ${auction.winner_name}</p>
                      <p style="font-size: 24px; color: #72AEC8; margin: 10px 0 0 0; font-weight: bold;">
                        ${new Intl.NumberFormat("en-US").format(auction.current_price)} VND
                      </p>
                    </div>
                    <p>The winner has been notified to complete payment. You will receive another notification once payment is confirmed.</p>
                    <div style="text-align: center; margin: 30px 0;">
                      <a href="${productUrl}" style="display: inline-block; background: linear-gradient(135deg, #72AEC8 0%, #5a9ab8 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        View Product
                      </a>
                    </div>
                  </div>
                  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                  <p style="color: #888; font-size: 12px; text-align: center;">This is an automated message from Online Auction. Please do not reply to this email.</p>
                </div>
              `,
            });
            console.log(
              `✅ Seller notification sent to ${auction.seller_email} for product #${auction.id}`,
            );
          }
        } else {
          // Không có người thắng - Chỉ thông báo cho người bán
          if (auction.seller_email) {
            await sendMail({
              to: auction.seller_email,
              subject: `⏰ Auction Ended: ${auction.name} - No Bidders`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background: linear-gradient(135deg, #6c757d 0%, #495057 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="color: white; margin: 0;">Auction Ended</h1>
                  </div>
                  <div style="background-color: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
                    <p>Dear <strong>${auction.seller_name}</strong>,</p>
                    <p>Unfortunately, your auction has ended without any bidders.</p>
                    <div style="background-color: white; padding: 20px; border-radius: 10px; margin: 20px 0; border-left: 4px solid #6c757d;">
                      <h3 style="margin: 0 0 10px 0; color: #333;">${auction.name}</h3>
                      <p style="color: #6c757d; margin: 0;">No bids received</p>
                    </div>
                    <p>You can relist this product or create a new auction with adjusted pricing.</p>
                    <div style="text-align: center; margin: 30px 0;">
                      <a href="${process.env.BASE_URL || "http://localhost:3005"}/seller/add" style="display: inline-block; background: linear-gradient(135deg, #72AEC8 0%, #5a9ab8 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        Create New Auction
                      </a>
                    </div>
                  </div>
                  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                  <p style="color: #888; font-size: 12px; text-align: center;">This is an automated message from Online Auction. Please do not reply to this email.</p>
                </div>
              `,
            });
            console.log(
              `✅ Seller notification (no bidders) sent to ${auction.seller_email} for product #${auction.id}`,
            );
          }
        }

        // Update product status
        const newStatus = auction.highest_bidder_id ? "PENDING" : "EXPIRED";
        await productModel.updateStatus(auction.id, newStatus);

        // Đánh dấu đã gửi thông báo
        await productModel.markEndNotificationSent(auction.id);
      } catch (emailError) {
        console.error(
          `❌ Failed to send notification for product #${auction.id}:`,
          emailError,
        );
      }
    }
  } catch (error) {
    console.error("❌ Error checking ended auctions:", error);
  }
}

/**
 * Khởi chạy job định kỳ
 * @param {number} intervalSeconds - Khoảng thời gian giữa các lần kiểm tra (giây)
 */
export function startAuctionEndNotifier(intervalSeconds = 30) {
  console.log(
    `🚀 Auction End Notifier started (checking every ${intervalSeconds} second(s))`,
  );

  // Chạy ngay lần đầu
  checkAndNotifyEndedAuctions();

  // Sau đó chạy định kỳ
  setInterval(checkAndNotifyEndedAuctions, intervalSeconds * 1000);
}
