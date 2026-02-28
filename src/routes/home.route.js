import express from "express";
import * as productCatalogModel from "../models/product.catalog.model.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    // Gọi song song 3 hàm để tiết kiệm thời gian (Promise.all)
    const [topEnding, topBids, topPrice] = await Promise.all([
      productCatalogModel.findTopEnding(),
      productCatalogModel.findTopBids(),
      productCatalogModel.findTopPrice(),
    ]);
    res.render("home", {
      topEndingProducts: topEnding,
      topBidsProducts: topBids,
      topPriceProducts: topPrice,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal Server Error");
  }
});

export default router;
