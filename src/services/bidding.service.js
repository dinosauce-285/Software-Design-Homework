import db from "../utils/db.js";
import * as reviewModel from "../models/review.model.js";
import * as systemSettingModel from "../models/systemSetting.model.js";
import { calculateNewBidState } from "./bidding.algorithm.js";

export class BiddingService {
  /**
   * Process an auto-bid or manual bid within a transaction.
   * @param {number} productId
   * @param {number} userId
   * @param {number} bidAmount
   * @returns {Object} Result object with bidding outcomes
   */
  static async placeBid(productId, userId, bidAmount) {
    // Use transaction with row-level locking to prevent race conditions
    return await db.transaction(async (trx) => {
      // 1. Lock the product row for update to prevent concurrent modifications
      const product = await trx("products")
        .where("id", productId)
        .forUpdate() // This creates a row-level lock
        .first();

      if (!product) {
        throw new Error("Product not found");
      }

      // Store previous highest bidder info for email notification
      const previousHighestBidderId = product.highest_bidder_id;
      const previousPrice = parseFloat(
        product.current_price || product.starting_price,
      );

      // 2. Check if product is already sold
      if (product.is_sold === true) {
        throw new Error("This product has already been sold");
      }

      // 3. Check if seller cannot bid on their own product
      if (product.seller_id === userId) {
        throw new Error("You cannot bid on your own product");
      }

      // 4. Check if bidder has been rejected
      const isRejected = await trx("rejected_bidders")
        .where("product_id", productId)
        .where("bidder_id", userId)
        .first();

      if (isRejected) {
        throw new Error(
          "You have been rejected from bidding on this product by the seller",
        );
      }

      // 5. Check rating point
      const ratingPoint = await reviewModel.calculateRatingPoint(userId);
      const userReviews = await reviewModel.getReviewsByUserId(userId);
      const hasReviews = userReviews.length > 0;

      if (!hasReviews) {
        // User has no reviews yet (unrated)
        if (!product.allow_unrated_bidder) {
          throw new Error(
            "This seller does not allow unrated bidders to bid on this product.",
          );
        }
      } else if (ratingPoint.rating_point < 0) {
        throw new Error(
          "You are not eligible to place bids due to your rating.",
        );
      } else if (ratingPoint.rating_point === 0) {
        throw new Error(
          "You are not eligible to place bids due to your rating.",
        );
      } else if (ratingPoint.rating_point <= 0.8) {
        throw new Error(
          "Your rating point is not greater than 80%. You cannot place bids.",
        );
      }

      // 6. Check if auction has ended
      const now = new Date();
      const endDate = new Date(product.end_at);
      if (now > endDate) {
        throw new Error("Auction has ended");
      }

      // 7. Validate bid amount against current price
      const currentPrice = parseFloat(
        product.current_price || product.starting_price,
      );

      if (bidAmount <= currentPrice) {
        throw new Error(
          `Bid must be higher than current price (${currentPrice.toLocaleString()} VND)`,
        );
      }

      // 8. Check minimum bid increment
      const minIncrement = parseFloat(product.step_price);
      if (bidAmount < currentPrice + minIncrement) {
        throw new Error(
          `Bid must be at least ${minIncrement.toLocaleString()} VND higher than current price`,
        );
      }

      // 9. Check and apply auto-extend if needed
      let extendedEndTime = null;
      if (product.auto_extend) {
        // Get system settings for auto-extend configuration
        const settings = await systemSettingModel.getSettings();
        const triggerMinutes = settings?.auto_extend_trigger_minutes || 5;
        const extendMinutes = settings?.auto_extend_duration_minutes || 10;

        // Calculate time remaining until auction ends
        const endTime = new Date(product.end_at);
        const minutesRemaining = (endTime - now) / (1000 * 60);

        // If within trigger window, extend the auction
        if (minutesRemaining <= triggerMinutes) {
          extendedEndTime = new Date(
            endTime.getTime() + extendMinutes * 60 * 1000,
          );

          // Update end_at in the product object for subsequent checks
          product.end_at = extendedEndTime;
        }
      }

      // ========== AUTOMATIC BIDDING LOGIC ==========
      const buyNowPrice = product.buy_now_price ? parseFloat(product.buy_now_price) : null;

      const {
        newCurrentPrice,
        newHighestBidderId,
        newHighestMaxPrice,
        shouldCreateHistory,
        productSold,
      } = calculateNewBidState(
        {
          product,
          buyNowPrice,
          currentPrice,
          minIncrement,
        },
        {
          userId,
          bidAmount,
        }
      );

      // 8. Update product with new price, highest bidder, and highest max price
      const updateData = {
        current_price: newCurrentPrice,
        highest_bidder_id: newHighestBidderId,
        highest_max_price: newHighestMaxPrice,
      };

      // If buy now price is reached, close auction immediately - takes priority over auto-extend
      if (productSold) {
        updateData.end_at = new Date(); // Kết thúc auction ngay lập tức
        updateData.closed_at = new Date();
        // is_sold remains NULL → Product goes to PENDING status (waiting for payment)
      }
      // If auto-extend was triggered and product NOT sold, update end_at
      else if (extendedEndTime) {
        updateData.end_at = extendedEndTime;
      }

      await trx("products").where("id", productId).update(updateData);

      // 9. Add bidding history record only if price changed
      // Record ghi lại người đang nắm giá sau khi tính toán automatic bidding
      if (shouldCreateHistory) {
        await trx("bidding_history").insert({
          product_id: productId,
          bidder_id: newHighestBidderId,
          current_price: newCurrentPrice,
        });
      }

      // 10. Update auto_bidding table for the bidder
      // Sử dụng raw query để upsert (insert or update)
      await trx.raw(
        `
        INSERT INTO auto_bidding (product_id, bidder_id, max_price)
        VALUES (?, ?, ?)
        ON CONFLICT (product_id, bidder_id)
        DO UPDATE SET 
          max_price = EXCLUDED.max_price,
          created_at = NOW()
      `,
        [productId, userId, bidAmount],
      );

      // Success message generation logic moved here to encapsulate it fully
      let baseMessage = "";
      if (productSold) {
        if (newHighestBidderId === userId) {
          baseMessage = `Congratulations! You won the product with Buy Now price: ${newCurrentPrice.toLocaleString()} VND. Please proceed to payment.`;
        } else {
          baseMessage = `Product has been sold to another bidder at Buy Now price: ${newCurrentPrice.toLocaleString()} VND. Your bid helped reach the Buy Now threshold.`;
        }
      } else if (newHighestBidderId === userId) {
        baseMessage = `Bid placed successfully! Current price: ${newCurrentPrice.toLocaleString()} VND (Your max: ${bidAmount.toLocaleString()} VND)`;
      } else {
        baseMessage = `Bid placed! Another bidder is currently winning at ${newCurrentPrice.toLocaleString()} VND`;
      }

      if (extendedEndTime) {
        const extendedTimeStr = new Date(extendedEndTime).toLocaleString(
          "vi-VN",
        );
        baseMessage += ` | Auction extended to ${extendedTimeStr}`;
      }

      return {
        newCurrentPrice,
        newHighestBidderId,
        userId,
        bidAmount,
        productSold,
        autoExtended: !!extendedEndTime,
        newEndTime: extendedEndTime,
        productName: product.name,
        sellerId: product.seller_id,
        previousHighestBidderId,
        previousPrice,
        priceChanged: previousPrice !== newCurrentPrice,
        message: baseMessage,
      };
    });
  }
}
