import express from "express";
import * as productCatalogModel from "../models/product.catalog.model.js";
import * as reviewModel from "../models/review.model.js";
import * as userModel from "../models/user.model.js";
import * as biddingHistoryModel from "../models/biddingHistory.model.js";
import * as productCommentModel from "../models/productComment.model.js";
import { isAuthenticated } from "../middlewares/auth.mdw.js";
import { sendMail } from "../utils/mailer.js";

const router = express.Router();

// ROUTE: POST COMMENT
router.post("/comment", isAuthenticated, async (req, res) => {
  const { productId, content, parentId } = req.body;
  const userId = req.session.authUser.id;

  try {
    if (!content || content.trim().length === 0) {
      req.session.error_message = "Comment cannot be empty";
      return res.redirect(`/products/detail?id=${productId}`);
    }

    // Create comment
    await productCommentModel.createComment(
      productId,
      userId,
      content.trim(),
      parentId || null,
    );

    // Get product and users for email notification
    const product = await productCatalogModel.findByProductId2(productId, null);
    const commenter = await userModel.findById(userId);
    const seller = await userModel.findById(product.seller_id);
    const productUrl = `${req.protocol}://${req.get("host")}/products/detail?id=${productId}`;

    // Check if the commenter is the seller (seller is replying)
    const isSellerReplying = userId === product.seller_id;

    if (isSellerReplying && parentId) {
      // Seller is replying to a question - notify all bidders and commenters
      const bidders = await biddingHistoryModel.getUniqueBidders(productId);
      const commenters =
        await productCommentModel.getUniqueCommenters(productId);

      // Combine and remove duplicates (exclude seller)
      const recipientsMap = new Map();

      bidders.forEach((b) => {
        if (b.id !== product.seller_id && b.email) {
          recipientsMap.set(b.id, { email: b.email, fullname: b.fullname });
        }
      });

      commenters.forEach((c) => {
        if (c.id !== product.seller_id && c.email) {
          recipientsMap.set(c.id, { email: c.email, fullname: c.fullname });
        }
      });

      // Send email to each recipient
      for (const [recipientId, recipient] of recipientsMap) {
        try {
          await sendMail({
            to: recipient.email,
            subject: `Seller answered a question on: ${product.name}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #667eea;">Seller Response on Product</h2>
                <p>Dear <strong>${recipient.fullname}</strong>,</p>
                <p>The seller has responded to a question on a product you're interested in:</p>
                <div style="background-color: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px 0;">
                  <p><strong>Product:</strong> ${product.name}</p>
                  <p><strong>Seller:</strong> ${seller.fullname}</p>
                  <p><strong>Answer:</strong></p>
                  <p style="background-color: white; padding: 15px; border-radius: 5px; border-left: 4px solid #667eea;">${content}</p>
                </div>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${productUrl}" style="display: inline-block; background-color: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                    View Product
                  </a>
                </div>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="color: #888; font-size: 12px;">This is an automated message from Online Auction. Please do not reply to this email.</p>
              </div>
            `,
          });
        } catch (emailError) {
          console.error(
            `Failed to send email to ${recipient.email}:`,
            emailError,
          );
        }
      }
      console.log(
        `Seller reply notification sent to ${recipientsMap.size} recipients`,
      );
    } else if (seller && seller.email && userId !== product.seller_id) {
      // Non-seller commenting - send email to seller
      if (parentId) {
        // This is a reply - send "New Reply" email
        await sendMail({
          to: seller.email,
          subject: `New reply on your product: ${product.name}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #667eea;">New Reply on Your Product</h2>
              <div style="background-color: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px 0;">
                <p><strong>Product:</strong> ${product.name}</p>
                <p><strong>From:</strong> ${commenter.fullname}</p>
                <p><strong>Reply:</strong></p>
                <p style="background-color: white; padding: 15px; border-radius: 5px;">${content}</p>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${productUrl}" style="display: inline-block; background-color: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                  View Product & Reply
                </a>
              </div>
            </div>
          `,
        });
      } else {
        // This is a new question - send "New Question" email
        await sendMail({
          to: seller.email,
          subject: `New question about your product: ${product.name}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #667eea;">New Question About Your Product</h2>
              <div style="background-color: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px 0;">
                <p><strong>Product:</strong> ${product.name}</p>
                <p><strong>From:</strong> ${commenter.fullname}</p>
                <p><strong>Question:</strong></p>
                <p style="background-color: white; padding: 15px; border-radius: 5px;">${content}</p>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${productUrl}" style="display: inline-block; background-color: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                  View Product & Answer
                </a>
              </div>
            </div>
          `,
        });
      }
    }

    req.session.success_message = "Comment posted successfully!";
    res.redirect(`/products/detail?id=${productId}`);
  } catch (error) {
    console.error("Post comment error:", error);
    req.session.error_message = "Failed to post comment. Please try again.";
    res.redirect(`/products/detail?id=${productId}`);
  }
});

// ROUTE: Seller Ratings Page
router.get("/seller/:sellerId/ratings", async (req, res) => {
  try {
    const sellerId = parseInt(req.params.sellerId);

    if (!sellerId) {
      return res.redirect("/");
    }

    // Get seller info
    const seller = await userModel.findById(sellerId);
    if (!seller) {
      return res.redirect("/");
    }

    // Get rating point
    const ratingData = await reviewModel.calculateRatingPoint(sellerId);
    const rating_point = ratingData ? ratingData.rating_point : 0;

    // Get all reviews
    const reviews = await reviewModel.getReviewsByUserId(sellerId);

    // Calculate statistics
    const totalReviews = reviews.length;
    const positiveReviews = reviews.filter((r) => r.rating === 1).length;
    const negativeReviews = reviews.filter((r) => r.rating === -1).length;

    res.render("vwProduct/seller-ratings", {
      sellerName: seller.fullname,
      rating_point,
      totalReviews,
      positiveReviews,
      negativeReviews,
      reviews,
    });
  } catch (error) {
    console.error("Error loading seller ratings page:", error);
    res.redirect("/");
  }
});

// ROUTE: Bidder Ratings Page
router.get("/bidder/:bidderId/ratings", async (req, res) => {
  try {
    const bidderId = parseInt(req.params.bidderId);

    if (!bidderId) {
      return res.redirect("/");
    }

    // Get bidder info
    const bidder = await userModel.findById(bidderId);
    if (!bidder) {
      return res.redirect("/");
    }

    // Get rating point
    const ratingData = await reviewModel.calculateRatingPoint(bidderId);
    const rating_point = ratingData ? ratingData.rating_point : 0;

    // Get all reviews
    const reviews = await reviewModel.getReviewsByUserId(bidderId);

    // Calculate statistics
    const totalReviews = reviews.length;
    const positiveReviews = reviews.filter((r) => r.rating === 1).length;
    const negativeReviews = reviews.filter((r) => r.rating === -1).length;

    // Mask bidder name
    const maskedName = bidder.fullname
      ? bidder.fullname
          .split("")
          .map((char, index) => (index % 2 === 0 ? char : "*"))
          .join("")
      : "";

    res.render("vwProduct/bidder-ratings", {
      bidderName: maskedName,
      rating_point,
      totalReviews,
      positiveReviews,
      negativeReviews,
      reviews,
    });
  } catch (error) {
    console.error("Error loading bidder ratings page:", error);
    res.redirect("/");
  }
});

export default router;
