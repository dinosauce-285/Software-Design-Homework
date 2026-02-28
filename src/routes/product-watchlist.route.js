import express from "express";
import * as watchListModel from "../models/watchlist.model.js";
import { isAuthenticated } from "../middlewares/auth.mdw.js";

const router = express.Router();

// ROUTE 1: THÊM VÀO WATCHLIST (POST)
router.post("/watchlist", isAuthenticated, async (req, res) => {
  const userId = req.session.authUser.id;
  const productId = req.body.productId;

  const isInWatchlist = await watchListModel.isInWatchlist(userId, productId);
  if (!isInWatchlist) {
    await watchListModel.addToWatchlist(userId, productId);
  }

  // SỬA LẠI: Lấy địa chỉ trang trước đó từ header
  // Nếu không tìm thấy (trường hợp hiếm), quay về trang chủ '/'
  const retUrl = req.headers.referer || "/";
  res.redirect(retUrl);
});

// ROUTE 2: XÓA KHỎI WATCHLIST (DELETE)
router.delete("/watchlist", isAuthenticated, async (req, res) => {
  const userId = req.session.authUser.id;
  const productId = req.body.productId;

  await watchListModel.removeFromWatchlist(userId, productId);

  // SỬA LẠI: Tương tự như trên
  const retUrl = req.headers.referer || "/";
  res.redirect(retUrl);
});

export default router;
