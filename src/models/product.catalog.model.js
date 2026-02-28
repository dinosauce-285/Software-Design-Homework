import db from "../utils/db.js";

export function findAll() {
  return db("products")
    .leftJoin("users as bidder", "products.highest_bidder_id", "bidder.id")
    .leftJoin("users as seller", "products.seller_id", "seller.id")
    .select(
      "products.*",
      "seller.fullname as seller_name",
      "bidder.fullname as highest_bidder_name",
      db.raw(`
        (
          SELECT COUNT(*) 
          FROM bidding_history 
          WHERE bidding_history.product_id = products.id
        ) AS bid_count
      `),
    );
}

export async function findByProductIdForAdmin(productId, userId) {
  const rows = await db("products")
    .leftJoin("users as bidder", "products.highest_bidder_id", "bidder.id")
    .leftJoin("users as seller", "products.seller_id", "seller.id")
    .leftJoin("product_images", "products.id", "product_images.product_id")
    .leftJoin("categories", "products.category_id", "categories.id")
    .leftJoin("watchlists", function () {
      this.on("products.id", "=", "watchlists.product_id").andOnVal(
        "watchlists.user_id",
        "=",
        userId || -1,
      );
    })
    .where("products.id", productId)
    .select(
      "products.*",
      "product_images.img_link",
      "bidder.fullname as highest_bidder_name",
      "seller.fullname as seller_name",
      "categories.name as category_name",
      db.raw(`
        (
          SELECT COUNT(*) 
          FROM bidding_history 
          WHERE bidding_history.product_id = products.id
        ) AS bid_count
      `),
      db.raw("watchlists.product_id IS NOT NULL AS is_favorite"),
    );

  if (rows.length === 0) return null;

  const product = rows[0];

  product.sub_images = rows
    .map((row) => row.img_link)
    .filter((link) => link && link !== product.thumbnail);

  return product;
}

export function findPage(limit, offset) {
  return db("products")
    .leftJoin("users", "products.highest_bidder_id", "users.id")
    .select(
      "products.*",
      db.raw(`mask_name_alternating(users.fullname) AS bidder_name`),
      db.raw(`
        (
          SELECT COUNT(*) 
          FROM bidding_history 
          WHERE bidding_history.product_id = products.id
        ) AS bid_count
      `),
    )
    .limit(limit)
    .offset(offset);
}

export function searchPageByKeywords(
  keywords,
  limit,
  offset,
  userId,
  logic = "or",
  sort = "",
) {
  const searchQuery = keywords
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");

  let query = db("products")
    .leftJoin("categories", "products.category_id", "categories.id")
    .leftJoin(
      "categories as parent_category",
      "categories.parent_id",
      "parent_category.id",
    )
    .leftJoin("users", "products.highest_bidder_id", "users.id")
    .leftJoin("watchlists", function () {
      this.on("products.id", "=", "watchlists.product_id").andOnVal(
        "watchlists.user_id",
        "=",
        userId || -1,
      );
    })
    .where("products.end_at", ">", new Date())
    .whereNull("products.closed_at")
    .where((builder) => {
      const words = searchQuery.split(/\s+/).filter((w) => w.length > 0);
      if (logic === "and") {
        words.forEach((word) => {
          builder.where(function () {
            this.whereRaw(`LOWER(remove_accents(products.name)) LIKE ?`, [
              `%${word}%`,
            ])
              .orWhereRaw(`LOWER(remove_accents(categories.name)) LIKE ?`, [
                `%${word}%`,
              ])
              .orWhereRaw(
                `LOWER(remove_accents(parent_category.name)) LIKE ?`,
                [`%${word}%`],
              );
          });
        });
      } else {
        words.forEach((word) => {
          builder.orWhere(function () {
            this.whereRaw(`LOWER(remove_accents(products.name)) LIKE ?`, [
              `%${word}%`,
            ])
              .orWhereRaw(`LOWER(remove_accents(categories.name)) LIKE ?`, [
                `%${word}%`,
              ])
              .orWhereRaw(
                `LOWER(remove_accents(parent_category.name)) LIKE ?`,
                [`%${word}%`],
              );
          });
        });
      }
    })
    .select(
      "products.*",
      "categories.name as category_name",
      db.raw(`mask_name_alternating(users.fullname) AS bidder_name`),
      db.raw(`
        ( 
          SELECT COUNT(*)
          FROM bidding_history
          WHERE bidding_history.product_id = products.id
        ) AS bid_count
      `),
      db.raw("watchlists.product_id IS NOT NULL AS is_favorite"),
    );

  if (sort === "price_asc") {
    query = query.orderBy("products.current_price", "asc");
  } else if (sort === "price_desc") {
    query = query.orderBy("products.current_price", "desc");
  } else if (sort === "newest") {
    query = query.orderBy("products.created_at", "desc");
  } else if (sort === "oldest") {
    query = query.orderBy("products.created_at", "asc");
  } else {
    query = query.orderBy("products.end_at", "asc");
  }

  return query.limit(limit).offset(offset);
}

export function countByKeywords(keywords, logic = "or") {
  const searchQuery = keywords
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");

  return db("products")
    .leftJoin("categories", "products.category_id", "categories.id")
    .leftJoin(
      "categories as parent_category",
      "categories.parent_id",
      "parent_category.id",
    )
    .where("products.end_at", ">", new Date())
    .whereNull("products.closed_at")
    .where((builder) => {
      const words = searchQuery.split(/\s+/).filter((w) => w.length > 0);
      if (logic === "and") {
        words.forEach((word) => {
          builder.where(function () {
            this.whereRaw(`LOWER(remove_accents(products.name)) LIKE ?`, [
              `%${word}%`,
            ])
              .orWhereRaw(`LOWER(remove_accents(categories.name)) LIKE ?`, [
                `%${word}%`,
              ])
              .orWhereRaw(
                `LOWER(remove_accents(parent_category.name)) LIKE ?`,
                [`%${word}%`],
              );
          });
        });
      } else {
        words.forEach((word) => {
          builder.orWhere(function () {
            this.whereRaw(`LOWER(remove_accents(products.name)) LIKE ?`, [
              `%${word}%`,
            ])
              .orWhereRaw(`LOWER(remove_accents(categories.name)) LIKE ?`, [
                `%${word}%`,
              ])
              .orWhereRaw(
                `LOWER(remove_accents(parent_category.name)) LIKE ?`,
                [`%${word}%`],
              );
          });
        });
      }
    })
    .count("products.id as count")
    .first();
}

export function countAll() {
  return db("products").count("id as count").first();
}

export function findByCategoryId(
  categoryId,
  limit,
  offset,
  sort,
  currentUserId,
) {
  return db("products")
    .leftJoin("users", "products.highest_bidder_id", "users.id")
    .leftJoin("watchlists", function () {
      this.on("products.id", "=", "watchlists.product_id").andOnVal(
        "watchlists.user_id",
        "=",
        currentUserId || -1,
      );
    })
    .where("products.category_id", categoryId)
    .where("products.end_at", ">", new Date())
    .whereNull("products.closed_at")
    .select(
      "products.*",
      db.raw(`mask_name_alternating(users.fullname) AS bidder_name`),
      db.raw(`
        (
          SELECT COUNT(*) 
          FROM bidding_history 
          WHERE bidding_history.product_id = products.id
        ) AS bid_count
      `),
      db.raw("watchlists.product_id IS NOT NULL AS is_favorite"),
    )
    .modify((queryBuilder) => {
      if (sort === "price_asc") {
        queryBuilder.orderBy("products.current_price", "asc");
      } else if (sort === "price_desc") {
        queryBuilder.orderBy("products.current_price", "desc");
      } else if (sort === "newest") {
        queryBuilder.orderBy("products.created_at", "desc");
      } else if (sort === "oldest") {
        queryBuilder.orderBy("products.created_at", "asc");
      } else {
        queryBuilder.orderBy("products.created_at", "desc");
      }
    })
    .limit(limit)
    .offset(offset);
}

export function countByCategoryId(categoryId) {
  return db("products")
    .where("category_id", categoryId)
    .count("id as count")
    .first();
}

export function findByCategoryIds(
  categoryIds,
  limit,
  offset,
  sort,
  currentUserId,
) {
  return db("products")
    .leftJoin("users", "products.highest_bidder_id", "users.id")
    .leftJoin("watchlists", function () {
      this.on("products.id", "=", "watchlists.product_id").andOnVal(
        "watchlists.user_id",
        "=",
        currentUserId || -1,
      );
    })
    .whereIn("products.category_id", categoryIds)
    .where("products.end_at", ">", new Date())
    .whereNull("products.closed_at")
    .select(
      "products.*",
      db.raw(`mask_name_alternating(users.fullname) AS bidder_name`),
      db.raw(`
        (
          SELECT COUNT(*) 
          FROM bidding_history 
          WHERE bidding_history.product_id = products.id
        ) AS bid_count
      `),
      db.raw("watchlists.product_id IS NOT NULL AS is_favorite"),
    )
    .modify((queryBuilder) => {
      if (sort === "price_asc") {
        queryBuilder.orderBy("products.current_price", "asc");
      } else if (sort === "price_desc") {
        queryBuilder.orderBy("products.current_price", "desc");
      } else if (sort === "newest") {
        queryBuilder.orderBy("products.created_at", "desc");
      } else if (sort === "oldest") {
        queryBuilder.orderBy("products.created_at", "asc");
      } else {
        queryBuilder.orderBy("products.created_at", "desc");
      }
    })
    .limit(limit)
    .offset(offset);
}

export function countByCategoryIds(categoryIds) {
  return db("products")
    .whereIn("category_id", categoryIds)
    .where("end_at", ">", new Date())
    .whereNull("closed_at")
    .count("id as count")
    .first();
}

const BASE_QUERY = db("products")
  .leftJoin("users", "products.highest_bidder_id", "users.id")
  .select(
    "products.*",
    db.raw(`mask_name_alternating(users.fullname) AS bidder_name`),
    db.raw(
      `(SELECT COUNT(*) FROM bidding_history WHERE product_id = products.id) AS bid_count`,
    ),
  )
  .where("end_at", ">", new Date())
  .limit(5);

export function findTopEnding() {
  return BASE_QUERY.clone()
    .where("products.end_at", ">", new Date())
    .whereNull("products.closed_at")
    .orderBy("end_at", "asc");
}

export function findTopPrice() {
  return BASE_QUERY.clone()
    .where("products.end_at", ">", new Date())
    .whereNull("products.closed_at")
    .orderBy("current_price", "desc");
}

export function findTopBids() {
  return db("products")
    .leftJoin("users", "products.highest_bidder_id", "users.id")
    .select(
      "products.*",
      db.raw(`mask_name_alternating(users.fullname) AS bidder_name`),
      db.raw(
        `(SELECT COUNT(*) FROM bidding_history WHERE product_id = products.id) AS bid_count`,
      ),
    )
    .where("products.end_at", ">", new Date())
    .whereNull("products.closed_at")
    .orderBy("bid_count", "desc")
    .limit(5);
}

export function findByProductId(productId) {
  return db("products")
    .leftJoin(
      "users as highest_bidder",
      "products.highest_bidder_id",
      "highest_bidder.id",
    )
    .leftJoin("product_images", "products.id", "product_images.product_id")
    .leftJoin("users as seller", "products.seller_id", "seller.id")
    .leftJoin("categories", "products.category_id", "categories.id")
    .where("products.id", productId)
    .select(
      "products.*",
      "product_images.img_link",
      "seller.fullname as seller_name",
      "seller.created_at as seller_created_at",
      "categories.name as category_name",
      db.raw(`mask_name_alternating(highest_bidder.fullname) AS bidder_name`),
      db.raw(`
        (
          SELECT COUNT(*) 
          FROM bidding_history 
          WHERE bidding_history.product_id = products.id
        ) AS bid_count
      `),
    );
}

export function findRelatedProducts(productId) {
  return db("products")
    .leftJoin("products as p2", "products.category_id", "p2.category_id")
    .where("products.id", productId)
    .andWhere("p2.id", "!=", productId)
    .select("p2.*")
    .limit(5);
}

export async function findByProductId2(productId, userId) {
  const rows = await db("products")
    .leftJoin("users", "products.highest_bidder_id", "users.id")
    .leftJoin("product_images", "products.id", "product_images.product_id")
    .leftJoin("watchlists", function () {
      this.on("products.id", "=", "watchlists.product_id").andOnVal(
        "watchlists.user_id",
        "=",
        userId || -1,
      );
    })
    .leftJoin("users as seller", "products.seller_id", "seller.id")
    .leftJoin("categories", "products.category_id", "categories.id")
    .where("products.id", productId)
    .select(
      "products.*",
      "product_images.img_link",
      "seller.fullname as seller_name",
      "seller.email as seller_email",
      "seller.created_at as seller_created_at",
      "categories.name as category_name",
      db.raw(`mask_name_alternating(users.fullname) AS bidder_name`),
      "users.fullname as highest_bidder_name",
      "users.email as highest_bidder_email",
      db.raw(`
        (
          SELECT COUNT(*) 
          FROM bidding_history 
          WHERE bidding_history.product_id = products.id
        ) AS bid_count
      `),
      db.raw("watchlists.product_id IS NOT NULL AS is_favorite"),
    );

  if (rows.length === 0) return null;

  const product = rows[0];

  product.sub_images = rows
    .map((row) => row.img_link)
    .filter((link) => link && link !== product.thumbnail);

  return product;
}
