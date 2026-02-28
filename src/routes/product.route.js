import express from "express";
import * as productCatalogModel from "../models/product.catalog.model.js";
import * as reviewModel from "../models/review.model.js";
import * as biddingHistoryModel from "../models/biddingHistory.model.js";
import * as productCommentModel from "../models/productComment.model.js";
import * as categoryModel from "../models/category.model.js";
import * as productDescUpdateModel from "../models/productDescriptionUpdate.model.js";
import * as systemSettingModel from "../models/systemSetting.model.js";
import * as rejectedBidderModel from "../models/rejectedBidder.model.js";
import { hasPermission, Permissions } from "../utils/rbac.js";
import { calculatePagination } from "../utils/paginationHelper.js";
const router = express.Router();

const prepareProductList = async (products) => {
  const now = new Date();
  if (!products) return [];

  // Load settings from database every time to get latest value
  const settings = await systemSettingModel.getSettings();
  const N_MINUTES = settings.new_product_limit_minutes;

  return products.map((product) => {
    const created = new Date(product.created_at);
    const isNew = now - created < N_MINUTES * 60 * 1000;

    return {
      ...product,
      is_new: isNew,
    };
  });
};

router.get("/category", async (req, res) => {
  const userId = req.session.authUser ? req.session.authUser.id : null;
  const sort = req.query.sort || "";
  const categoryId = req.query.catid;
  const page = parseInt(req.query.page) || 1;
  const limit = 3;
  const offset = (page - 1) * limit;

  // Check if category is level 1 (parent_id is null)
  const category = await categoryModel.findByCategoryId(categoryId);

  let categoryIds = [categoryId];

  // If it's a level 1 category, include all child categories
  if (category && category.parent_id === null) {
    const childCategories =
      await categoryModel.findChildCategoryIds(categoryId);
    const childIds = childCategories.map((cat) => cat.id);
    categoryIds = [categoryId, ...childIds];
  }

  const list = await productCatalogModel.findByCategoryIds(
    categoryIds,
    limit,
    offset,
    sort,
    userId,
  );
  const products = await prepareProductList(list);
  const total = await productCatalogModel.countByCategoryIds(categoryIds);
  console.log("Total products in category:", total.count);
  const totalCount = parseInt(total.count) || 0;
  const paginationData = calculatePagination(totalCount, page, limit);

  res.render("vwProduct/list", {
    products: products,
    ...paginationData,
    categoryId: categoryId,
    categoryName: category ? category.name : null,
    sort: sort,
  });
});

router.get("/search", async (req, res) => {
  const userId = req.session.authUser ? req.session.authUser.id : null;
  const q = req.query.q || "";
  const logic = req.query.logic || "and"; // 'and' or 'or'
  const sort = req.query.sort || "";

  // If keyword is empty, return empty results
  if (q.length === 0) {
    return res.render("vwProduct/list", {
      q: q,
      logic: logic,
      sort: sort,
      products: [],
      totalCount: 0,
      from: 0,
      to: 0,
      currentPage: 1,
      totalPages: 0,
    });
  }

  const limit = 3;
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * limit;

  // Pass keywords directly without modification
  // plainto_tsquery will handle tokenization automatically
  const keywords = q.trim();

  // Search in both product name and category
  const list = await productCatalogModel.searchPageByKeywords(
    keywords,
    limit,
    offset,
    userId,
    logic,
    sort,
  );
  const products = await prepareProductList(list);
  const total = await productCatalogModel.countByKeywords(keywords, logic);
  const totalCount = parseInt(total.count) || 0;
  const paginationData = calculatePagination(totalCount, page, limit);

  res.render("vwProduct/list", {
    products: products,
    ...paginationData,
    q: q,
    logic: logic,
    sort: sort,
  });
});

router.get("/detail", async (req, res) => {
  const userId = req.session.authUser ? req.session.authUser.id : null;
  const productId = req.query.id;
  const product = await productCatalogModel.findByProductId2(productId, userId);
  const related_products =
    await productCatalogModel.findRelatedProducts(productId);

  // Kiểm tra nếu không tìm thấy sản phẩm
  if (!product) {
    return res.status(404).render("404", { message: "Product not found" });
  }
  console.log("Product details:", product);
  // Determine product status
  const productStatus = product.status;

  // Authorization check: Non-ACTIVE products can only be viewed by seller or highest bidder
  if (productStatus !== "ACTIVE") {
    if (!userId) {
      // User not logged in, cannot view non-active products
      return res.status(403).render("403", {
        message: "You do not have permission to view this product",
      });
    }

    const isSeller = product.seller_id === userId;
    const isHighestBidder = product.highest_bidder_id === userId;

    const role = req.session.authUser?.role;
    const canViewAll = hasPermission(role, Permissions.VIEW_ALL_PRODUCTS);

    if (!isSeller && !isHighestBidder && !canViewAll) {
      return res.status(403).render("403", {
        message: "You do not have permission to view this product",
      });
    }
  }

  // Pagination for comments
  const commentPage = parseInt(req.query.commentPage) || 1;
  const commentsPerPage = 2; // 2 comments per page
  const offset = (commentPage - 1) * commentsPerPage;

  // Load description updates, bidding history, and comments in parallel
  const [descriptionUpdates, biddingHistory, comments, totalComments] =
    await Promise.all([
      productDescUpdateModel.findByProductId(productId),
      biddingHistoryModel.getBiddingHistory(productId),
      productCommentModel.getCommentsByProductId(
        productId,
        commentsPerPage,
        offset,
      ),
      productCommentModel.countCommentsByProductId(productId),
    ]);

  // Load rejected bidders (only for seller)
  let rejectedBidders = [];
  if (req.session.authUser && product.seller_id === req.session.authUser.id) {
    rejectedBidders = await rejectedBidderModel.getRejectedBidders(productId);
  }

  // Load replies for all comments in one batch to avoid N+1 query problem
  if (comments.length > 0) {
    const commentIds = comments.map((c) => c.id);
    const allReplies =
      await productCommentModel.getRepliesByCommentIds(commentIds);

    // Group replies by parent comment id
    const repliesMap = new Map();
    for (const reply of allReplies) {
      if (!repliesMap.has(reply.parent_id)) {
        repliesMap.set(reply.parent_id, []);
      }
      repliesMap.get(reply.parent_id).push(reply);
    }

    // Attach replies to their parent comments
    for (const comment of comments) {
      comment.replies = repliesMap.get(comment.id) || [];
    }
  }

  // Calculate total pages
  const totalPages = Math.ceil(totalComments / commentsPerPage);

  // Get flash messages from session
  const success_message = req.session.success_message;
  const error_message = req.session.error_message;
  delete req.session.success_message;
  delete req.session.error_message;

  // Get seller rating
  const sellerRatingObject = await reviewModel.calculateRatingPoint(
    product.seller_id,
  );
  const sellerReviews = await reviewModel.getReviewsByUserId(product.seller_id);

  // Get bidder rating (if exists)
  let bidderRatingObject = { rating_point: null };
  let bidderReviews = [];
  if (product.highest_bidder_id) {
    bidderRatingObject = await reviewModel.calculateRatingPoint(
      product.highest_bidder_id,
    );
    bidderReviews = await reviewModel.getReviewsByUserId(
      product.highest_bidder_id,
    );
  }

  // Check if should show payment button (for seller or highest bidder when status is PENDING)
  let showPaymentButton = false;
  if (req.session.authUser && productStatus === "PENDING") {
    const userId = req.session.authUser.id;
    showPaymentButton =
      product.seller_id === userId || product.highest_bidder_id === userId;
  }

  res.render("vwProduct/details", {
    product,
    productStatus, // Pass status to view
    authUser: req.session.authUser, // Pass authUser for checking highest_bidder_id
    descriptionUpdates,
    biddingHistory,
    rejectedBidders,
    comments,
    success_message,
    error_message,
    related_products,
    seller_rating_point: sellerRatingObject.rating_point,
    seller_has_reviews: sellerReviews.length > 0,
    bidder_rating_point: bidderRatingObject.rating_point,
    bidder_has_reviews: bidderReviews.length > 0,
    commentPage,
    totalPages,
    totalComments,
    showPaymentButton,
  });
});

export default router;
