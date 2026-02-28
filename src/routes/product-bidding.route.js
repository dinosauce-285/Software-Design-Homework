import express from "express";
import * as productCatalogModel from "../models/product.catalog.model.js";
import * as biddingHistoryModel from "../models/biddingHistory.model.js";
import * as rejectedBidderModel from "../models/rejectedBidder.model.js";
import * as reviewModel from "../models/review.model.js";
import { isAuthenticated } from "../middlewares/auth.mdw.js";
import { sendMail } from "../utils/mailer.js";
import db from "../utils/db.js";
import { BiddingService } from "../services/bidding.service.js";
import { NotificationService } from "../services/notification.service.js";

const router = express.Router();

// ROUTE: BIDDING HISTORY PAGE (Requires Authentication)
router.get("/bidding-history", isAuthenticated, async (req, res) => {
  const productId = req.query.id;

  if (!productId) {
    return res.redirect("/");
  }

  try {
    // Get product information
    const product = await productCatalogModel.findByProductId2(productId, null);

    if (!product) {
      return res.status(404).render("404", { message: "Product not found" });
    }

    // Load bidding history
    const biddingHistory =
      await biddingHistoryModel.getBiddingHistory(productId);

    res.render("vwProduct/biddingHistory", {
      product,
      biddingHistory,
    });
  } catch (error) {
    console.error("Error loading bidding history:", error);
    res
      .status(500)
      .render("500", { message: "Unable to load bidding history" });
  }
});

// ROUTE 3: ĐẶT GIÁ (POST) - Refactored using SRP
router.post("/bid", isAuthenticated, async (req, res) => {
  const userId = req.session.authUser.id;
  const productId = parseInt(req.body.productId);
  const bidAmount = parseFloat(req.body.bidAmount.replace(/,/g, "")); // Remove commas from input

  try {
    // 1. Core Logic handled by BiddingService
    const result = await BiddingService.placeBid(productId, userId, bidAmount);

    // 2. Notification handled asynchronously by NotificationService
    const hostContext = `${req.protocol}://${req.get("host")}`;
    NotificationService.sendBidNotifications(result, hostContext);

    // 3. User feedback
    req.session.success_message = result.message;
    res.redirect(`/products/detail?id=${productId}`);
  } catch (error) {
    console.error("Bid error:", error);
    req.session.error_message =
      error.message || "An error occurred while placing bid. Please try again.";
    res.redirect(`/products/detail?id=${productId}`);
  }
});

// ROUTE 4: GET BIDDING HISTORY (API for modal)
router.get("/bid-history/:productId", async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    const history = await biddingHistoryModel.getBiddingHistory(productId);
    res.json({ success: true, data: history });
  } catch (error) {
    console.error("Get bid history error:", error);
    res
      .status(500)
      .json({ success: false, message: "Unable to load bidding history" });
  }
});

// ROUTE: REJECT BIDDER (POST) - Seller rejects a bidder from a product
router.post("/reject-bidder", isAuthenticated, async (req, res) => {
  const { productId, bidderId } = req.body;
  const sellerId = req.session.authUser.id;

  try {
    let rejectedBidderInfo = null;
    let productInfo = null;
    let sellerInfo = null;

    // Use transaction to ensure data consistency
    await db.transaction(async (trx) => {
      // 1. Lock and verify product ownership
      const product = await trx("products")
        .where("id", productId)
        .forUpdate()
        .first();

      if (!product) {
        throw new Error("Product not found");
      }

      if (product.seller_id !== sellerId) {
        throw new Error("Only the seller can reject bidders");
      }

      // Check product status - only allow rejection for ACTIVE products
      if (product.status !== "ACTIVE") {
        throw new Error("Can only reject bidders for active auctions");
      }

      // 2. Check if bidder has actually bid on this product
      const autoBid = await trx("auto_bidding")
        .where("product_id", productId)
        .where("bidder_id", bidderId)
        .first();

      if (!autoBid) {
        throw new Error("This bidder has not placed a bid on this product");
      }

      // Get bidder info for email notification
      rejectedBidderInfo = await trx("users").where("id", bidderId).first();

      productInfo = product;
      sellerInfo = await trx("users").where("id", sellerId).first();

      // 3. Add to rejected_bidders table
      await trx("rejected_bidders")
        .insert({
          product_id: productId,
          bidder_id: bidderId,
          seller_id: sellerId,
        })
        .onConflict(["product_id", "bidder_id"])
        .ignore();

      // 4. Remove all bidding history of this bidder for this product
      await trx("bidding_history")
        .where("product_id", productId)
        .where("bidder_id", bidderId)
        .del();

      // 5. Remove from auto_bidding
      await trx("auto_bidding")
        .where("product_id", productId)
        .where("bidder_id", bidderId)
        .del();

      // 6. Recalculate highest bidder and current price
      // Always check remaining bidders after rejection
      const allAutoBids = await trx("auto_bidding")
        .where("product_id", productId)
        .orderBy("max_price", "desc");

      const bidderIdNum = parseInt(bidderId);
      const highestBidderIdNum = parseInt(product.highest_bidder_id);
      const wasHighestBidder = highestBidderIdNum === bidderIdNum;

      if (allAutoBids.length === 0) {
        // No more bidders - reset to starting state
        await trx("products").where("id", productId).update({
          highest_bidder_id: null,
          current_price: product.starting_price,
          highest_max_price: null,
        });
        // Don't add bidding history - no one actually bid
      } else if (allAutoBids.length === 1) {
        // Only one bidder left - they win at starting price (no competition)
        const winner = allAutoBids[0];
        const newPrice = product.starting_price;

        await trx("products").where("id", productId).update({
          highest_bidder_id: winner.bidder_id,
          current_price: newPrice,
          highest_max_price: winner.max_price,
        });

        // Add history entry only if price changed
        if (wasHighestBidder || product.current_price !== newPrice) {
          await trx("bidding_history").insert({
            product_id: productId,
            bidder_id: winner.bidder_id,
            current_price: newPrice,
          });
        }
      } else if (wasHighestBidder) {
        // Multiple bidders and rejected was highest - recalculate price
        const firstBidder = allAutoBids[0];
        const secondBidder = allAutoBids[1];

        // Current price should be minimum to beat second highest
        let newPrice = secondBidder.max_price + product.step_price;

        // But cannot exceed first bidder's max
        if (newPrice > firstBidder.max_price) {
          newPrice = firstBidder.max_price;
        }

        await trx("products").where("id", productId).update({
          highest_bidder_id: firstBidder.bidder_id,
          current_price: newPrice,
          highest_max_price: firstBidder.max_price,
        });

        // Add history entry only if price changed
        const lastHistory = await trx("bidding_history")
          .where("product_id", productId)
          .orderBy("created_at", "desc")
          .first();

        if (!lastHistory || lastHistory.current_price !== newPrice) {
          await trx("bidding_history").insert({
            product_id: productId,
            bidder_id: firstBidder.bidder_id,
            current_price: newPrice,
          });
        }
      }
      // If rejected bidder was NOT the highest bidder and still multiple bidders left,
      // don't update anything - just removing them from auto_bidding is enough
    });

    // Send email notification to rejected bidder (outside transaction) - asynchronously
    if (rejectedBidderInfo && rejectedBidderInfo.email && productInfo) {
      // Don't await - send email in background
      sendMail({
        to: rejectedBidderInfo.email,
        subject: `Your bid has been rejected: ${productInfo.name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0;">Bid Rejected</h1>
            </div>
            <div style="background-color: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
              <p>Dear <strong>${rejectedBidderInfo.fullname}</strong>,</p>
              <p>We regret to inform you that the seller has rejected your bid on the following product:</p>
              <div style="background-color: white; padding: 20px; border-radius: 10px; margin: 20px 0; border-left: 4px solid #dc3545;">
                <h3 style="margin: 0 0 10px 0; color: #333;">${productInfo.name}</h3>
                <p style="margin: 5px 0; color: #666;"><strong>Seller:</strong> ${sellerInfo ? sellerInfo.fullname : "N/A"}</p>
              </div>
              <p style="color: #666;">This means you can no longer place bids on this specific product. Your previous bids on this product have been removed.</p>
              <p style="color: #666;">You can still participate in other auctions on our platform.</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${req.protocol}://${req.get("host")}/" style="display: inline-block; background: linear-gradient(135deg, #72AEC8 0%, #5a9ab8 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                  Browse Other Auctions
                </a>
              </div>
              <p style="color: #888; font-size: 13px;">If you believe this was done in error, please contact our support team.</p>
            </div>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; text-align: center;">This is an automated message from Online Auction. Please do not reply to this email.</p>
          </div>
        `,
      })
        .then(() => {
          console.log(
            `Rejection email sent to ${rejectedBidderInfo.email} for product #${productId}`,
          );
        })
        .catch((emailError) => {
          console.error("Failed to send rejection email:", emailError);
        });
    }

    res.json({ success: true, message: "Bidder rejected successfully" });
  } catch (error) {
    console.error("Error rejecting bidder:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to reject bidder",
    });
  }
});

// ROUTE: UNREJECT BIDDER (POST) - Seller removes a bidder from rejected list
router.post("/unreject-bidder", isAuthenticated, async (req, res) => {
  const { productId, bidderId } = req.body;
  const sellerId = req.session.authUser.id;

  try {
    // Verify product ownership
    const product = await productCatalogModel.findByProductId2(
      productId,
      sellerId,
    );

    if (!product) {
      throw new Error("Product not found");
    }

    if (product.seller_id !== sellerId) {
      throw new Error("Only the seller can unreject bidders");
    }

    // Check product status - only allow unrejection for ACTIVE products
    if (product.status !== "ACTIVE") {
      throw new Error("Can only unreject bidders for active auctions");
    }

    // Remove from rejected_bidders table
    await rejectedBidderModel.unrejectBidder(productId, bidderId);

    res.json({
      success: true,
      message: "Bidder can now bid on this product again",
    });
  } catch (error) {
    console.error("Error unrejecting bidder:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to unreject bidder",
    });
  }
});

// ROUTE: BUY NOW (POST) - Bidder directly purchases product at buy now price
router.post("/buy-now", isAuthenticated, async (req, res) => {
  const { productId } = req.body;
  const userId = req.session.authUser.id;

  try {
    await db.transaction(async (trx) => {
      // 1. Get product information
      const product = await trx("products")
        .leftJoin("users as seller", "products.seller_id", "seller.id")
        .where("products.id", productId)
        .select("products.*", "seller.fullname as seller_name")
        .first();

      if (!product) {
        throw new Error("Product not found");
      }

      // 2. Check if user is the seller
      if (product.seller_id === userId) {
        throw new Error("Seller cannot buy their own product");
      }

      // 3. Check if product is still ACTIVE
      const now = new Date();
      const endDate = new Date(product.end_at);

      if (product.is_sold !== null) {
        throw new Error("Product is no longer available");
      }

      if (endDate <= now || product.closed_at) {
        throw new Error("Auction has already ended");
      }

      // 4. Check if buy_now_price exists
      if (!product.buy_now_price) {
        throw new Error("Buy Now option is not available for this product");
      }

      const buyNowPrice = parseFloat(product.buy_now_price);

      // 5. Check if bidder is rejected
      const isRejected = await trx("rejected_bidders")
        .where({ product_id: productId, bidder_id: userId })
        .first();

      if (isRejected) {
        throw new Error("You have been rejected from bidding on this product");
      }

      // 6. Check if bidder is unrated and product doesn't allow unrated bidders
      if (!product.allow_unrated_bidder) {
        const bidder = await trx("users").where("id", userId).first();
        const ratingData = await reviewModel.calculateRatingPoint(userId);
        const ratingPoint = ratingData ? ratingData.rating_point : 0;

        if (ratingPoint === 0) {
          throw new Error(
            "This product does not allow bidders without ratings",
          );
        }
      }

      // 7. Close the auction immediately at buy now price
      // Mark as buy_now_purchase to distinguish from regular bidding wins
      await trx("products").where("id", productId).update({
        current_price: buyNowPrice,
        highest_bidder_id: userId,
        highest_max_price: buyNowPrice,
        end_at: now,
        closed_at: now,
        is_buy_now_purchase: true,
      });

      // 8. Create bidding history record
      // Mark this record as a Buy Now purchase (not a regular bid)
      await trx("bidding_history").insert({
        product_id: productId,
        bidder_id: userId,
        current_price: buyNowPrice,
        is_buy_now: true,
      });
    });

    res.json({
      success: true,
      message:
        "Congratulations! You have successfully purchased the product at Buy Now price. Please proceed to payment.",
      redirectUrl: `/products/complete-order?id=${productId}`,
    });
  } catch (error) {
    console.error("Buy Now error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to purchase product",
    });
  }
});

export default router;
