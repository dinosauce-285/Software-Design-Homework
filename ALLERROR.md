## I. Nguyên lý SOLID

### 1. Single Responsibility Principle (SRP) - Nguyên lý Đơn nhiệm

**Định nghĩa:** Một module, class hoặc function chỉ nên có một lý do duy nhất để thay đổi (chỉ đảm nhiệm một trách nhiệm duy nhất).

**❖ Vị trí vi phạm & Mã nguồn:**

- **Route POST `/bid` (trong `src/routes/product.route.js`):** Khối lệnh dài 250–400 dòng gánh vác quá nhiều tác vụ: phân tích HTTP Request, logic auto-bidding rẽ nhánh phức tạp, lock Database, định dạng HTML và gửi email bất đồng bộ.

```javascript
// src/routes/product.route.js
router.post("/bid", isAuthenticated, async (req, res) => {
  // Phân tích HTTP Request
  const { product_id, bid_amount } = req.body;

  // Auto-bidding logic thay đổi giá trần
  if (autoBidding) {
    /* ... */
  }

  // Database Locking
  await db.transaction(async (trx) => {
    await trx("products").where("id", product_id).forUpdate();
    // ...
  });

  // Rải HTML nội vi và Gọi email bất đồng bộ
  sendMail({ to: sellerEmail, html: `<h1>Có lượt bid mới</h1>` });
});
```

- **Route POST `/signup` (trong `src/routes/account.route.js`):** Xử lý luồng quá dài từ Validate input thủ công, gọi HTTP check Captcha, băm mật khẩu (bcrypt), lưu User vào Database, tạo OTP ngẫu nhiên, cho đến định dạng và gửi Email HTML.

**❖ Đánh giá tác động:** Các file này bị quá tải trách nhiệm, trở nên khó đọc, khó debug. Việc sửa đổi một tính năng nhỏ lẻ như giao diện email có nguy cơ làm hỏng luồng đặt giá cốt lõi hoặc luồng đăng ký.
**❖ Giải pháp:** Tách logic thành các service riêng biệt như `BiddingService` và `AuthService`. Các module Validation, gọi API Captcha ngoại vi, hoặc gửi email nên được đưa ra các Middleware và Service vệ tinh.

**❖ Minh chứng & Kết quả Refactor:**
_Khắc phục lỗi vi phạm SRP bằng cách tách Service tạo User và Check Captcha._

**1. Tạo Mới `AuthService` (Tách logic đăng ký và OTP)**

- **Trước khi sửa:** Route `POST /signup` tự tay thực hiện gọi DB kiểm tra email trùng, băm mật khẩu, lưu user, rồi tự tay render mã OTP và lưu tiếp vào DB.

```javascript
// TRƯỚC — account.route.js, POST /signup
const hashedPassword = bcrypt.hashSync(req.body.password, 10);
const user = { email: req.body.email, password_hash: hashedPassword /*...*/ };
const newUser = await userModel.add(user);

const otp = generateOtp();
const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
await userModel.createOtp({ user_id: newUser.id, otp_code: otp /*...*/ });
```

- **Sau khi sửa:** Toàn bộ quá trình tạo User + Hash pass + Sinh OTP được đóng gói vào `AuthService.registerUser`. Route chỉ đảm nhận việc gọi Service và gửi mồi email, giúp code controller thu gọn đáng kể và tuân thủ chặt chẽ SRP.

```javascript
// SAU — account.route.js, POST /signup
try {
  // 3. Register user (hash, save, OTP) — toàn bộ trong service
  const { user, otp } = await AuthService.registerUser({ email, fullname, address, password });

  // 4. Gửi email xác thực — vẫn ở route (vì cần req context)
  await sendMail({ to: email, subject: '...', html: `...${otp}...` });

  return res.redirect(`/account/verify-email?email=${encodeURIComponent(email)}`);
} catch (err) { ... }
```

**2. Tạo Mới `CaptchaService` (Tách logic HTTP Fetch thứ 3)**

- **Vấn đề cũ:** Viết sống (inline) khối lệnh fetch API của Google dài 20 dòng ngay giữa route handler `/signup`.
- **Sau khi sửa:** Logic gọi Google reCAPTCHA được tách sang `CaptchaService.verify()`. Đặc biệt, Service bổ sung tính năng **Dev Mode Bypass** — nếu biến môi trường thiếu `RECAPTCHA_SECRET`, hàm sẽ tự động bỏ qua check thay vì làm crash app. Trải nghiệm phát triển (DX) được tăng cao mả code Controller chỉ tốn đúng 2 dòng.

```javascript
// SAU — account.route.js (POST /signup)
const isCaptchaValid = await CaptchaService.verify(recaptchaResponse);
if (!isCaptchaValid) {
  errors.captcha = "Captcha verification failed or missing. Please try again.";
}
```

> **Lưu ý Code Style:** Đợt refactor này cũng áp dụng chuẩn hóa Formatting (đổi nháy đơn thành nháy kép, chèn Trailing comma, Wrap tham số dòng dài cho các middleware như Passport/Multer và fix lại Indent thò thụt chưa chuẩn trong các Route).

**3. Khắc phục God Route `product.route.js` (Tách Route theo Domain)**

- **Vấn đề cũ:** File `product.route.js` ban đầu phình to hơn 1,500 dòng, nhồi nhét mọi thứ từ hiển thị tĩnh, đặt giá (bid), quản lý đơn hàng (order), bình luận (review), cho tới danh sách yêu thích (watchlist). Việc gom toàn bộ trách nhiệm vào một "God Route" khiến file cực kỳ khó bảo trì, dễ sinh conflict khi team làm việc chung.
- **Sau khi sửa:** Phân tách `product.route.js` thành 5 file chuyên biệt, mỗi file chỉ đảm nhiệm một nhóm ngữ cảnh duy nhất:
  - `product.route.js` (Còn ~288 dòng): Chỉ giữ chức năng CRUD cơ bản và Render các trang Product Listing/Detail.
  - `product-bidding.route.js` (421 dòng): Quản lý luồng đấu giá (`/bid`, `/bidding-history`, `/reject-bidder`, `/buy-now`). Các HTTP requests ở đây xử lý Transaction rất tỉ mỉ (Database Lock, kiểm tra phiên) và delegate logic cho `BiddingService`.
  - `product-order.route.js` (394 dòng): Quản lý vòng đời đơn giản sau đấu giá (Upload biên lai, xác nhận vận chuyển) kết hợp hệ thống nhắn tin (Chat) giữa Buyer và Seller.
  - `product-review.route.js` (246 dòng): Quản lý logic bình luận, câu hỏi FAQ và đánh giá uy tín (có Mask/Che đi tên người dùng thực ví dụ `N*u*e* *a* *n`).
  - `product-watchlist.route.js` (35 dòng): Tính năng thêm/xoá sản phẩm yêu thích.

```javascript
// SAU — src/index.js (Phân luồng Middleware & Route)
import productBiddingRouter from "./routes/product-bidding.route.js";
import productOrderRouter from "./routes/product-order.route.js";
import productReviewRouter from "./routes/product-review.route.js";
import productWatchlistRouter from "./routes/product-watchlist.route.js";

app.use("/products", productRouter);
app.use("/products", productBiddingRouter);
app.use("/products", productOrderRouter);
app.use("/products", productReviewRouter);
app.use("/products", productWatchlistRouter);
```

> **Sửa Bug ngầm:** Ở route cũ `GET /bid-history/:productId` có đoạn gọi try-catch gửi thẳng JSON response xuống cho View, tuy nhiên các dòng code truy xuất DB và render Template đằng sau catch không bao giờ có thể chạy được (Unreachable code). Đợt refactor này đã xử lý dọn dẹp biến endpoint này thành một pure JSON API thực thụ.

### 2. Open/Closed Principle (OCP) - Nguyên lý Mở rộng/Đóng gói

**Định nghĩa:** Hệ thống nên mở cho việc mở rộng (thêm tính năng mới) nhưng đóng cho việc sửa đổi (không làm thay đổi code cũ).

**❖ Vị trí vi phạm & Mã nguồn:**

- **Logic Quản trị Trạng thái Sản phẩm (`product.route.js`):** Không có cột `status` trong Database. Trạng thái được định tuyến "On-the-fly" bằng vô số lệnh `if-else` lồng nhau mỗi khi Load sản phẩm.

```javascript
const isEnd = new Date(product.end_at) < new Date();
if (product.is_sold) {
  product.status = "Sold";
} else if (product.closed_at) {
  product.status = "Cancelled";
} else if (isEnd) {
  product.status = product.highest_bidder_id ? "Pending" : "Expired";
} else {
  product.status = "Active";
}
```

- **Middleware Phân Quyền (`src/middlewares/auth.mdw.js`):** Gán cứng tên vai trò bằng lệnh `===`.

```javascript
export function isSeller(req, res, next) {
  if (req.session.authUser.role === "seller") {
    // Mã cứng định danh
    next();
  } else {
    res.redirect("/account/login");
  }
}
```

**❖ Đánh giá tác động:** Khi cần thêm trạng thái mới (VD: Disputed, Returned) hay vai trò mới (Moderator), lập trình viên bắt buộc phải mở hàng loạt file để sửa các chuỗi `if-else`. Rủi ro sinh bug chéo rất cao.
**❖ Giải pháp:** Thêm trường `status` lưu trực tiếp trong CSDL và sử dụng **State Design Pattern**. Đổi hệ thống phân quyền sang mô hình **RBAC (Role-Based Access Control)** linh hoạt hơn thay vì hard-code chuỗi tên vai trò.

**❖ Minh chứng & Kết quả Refactor:**
_Khắc phục lỗi định tuyến trạng thái On-the-fly bằng State Machine và lưu DB._

**1. Tạo Mới `ProductState` (State Machine)**

- **Trước khi sửa:** Mỗi route handler (`GET /detail`, `GET /complete-order`) tự tính `productStatus` từ các điều kiện lồng nhau, lặp lại code ở nhiều nơi.

```javascript
// TRƯỚC — lặp lại ~15 dòng ở mỗi route
const endDate = new Date(product.end_at);
let productStatus = "ACTIVE";
if (product.is_sold === true) {
  productStatus = "SOLD";
} else if (product.is_sold === false) {
  productStatus = "CANCELLED";
} else if ((endDate <= now || product.closed_at) && product.highest_bidder_id) {
  productStatus = "PENDING";
}
// ...
```

- **Sau khi sửa:** Trạng thái được chuẩn hóa bằng chuỗi Enum `ObjectStatus` và có State Machine (`ProductState.isValidTransition`) giám sát định tuyến hợp lệ (VD: từ `ACTIVE` không được nhảy thẳng qua `SOLD` nếu chưa qua `PENDING` trừ trường hợp mua ngay). Cột `status` được lưu cứng xuống DB.

```javascript
// SAU — GET /detail và /complete-order (chỉ còn 1 dòng)
const productStatus = product.status;
```

```javascript
// src/utils/product.state.js
export class ProductState {
  static isValidTransition(currentState, targetState) {
    if (currentState === ObjectStatus.ACTIVE) {
      return [SOLD, PENDING, EXPIRED, CANCELLED].includes(targetState);
    }
    // ...
  }
}
```

**2. Cập nhật Model và Notifier**

- **Hàm mới:** Tạo `productModel.updateStatus()` để mọi thay đổi trạng thái đều đi qua khâu xác thực `ProductState.isValidTransition()`.
- **Cron Job (auctionEndNotifier):** Thay vì các route tự đóng auction (sinh lỗi khi rẽ nhánh), Notifier giờ đây đảm bảo trách nhiệm duy nhất là phân định `PENDING` hoặc `EXPIRED` và update vào cột `status` trước khi gửi mail.

> **Làm sạch SQL Query:** Các hàm `findAllProductsBySellerId` trước đây phải nhọc nhằn dùng `CASE WHEN ... THEN` dài thò lò để tự render status inline bằng Raw SQL, nay chỉ việc `SELECT products.status as status`.

**3. Tạo Mới Hệ thống Phân Quyền `RBAC System`**

- **Trước khi sửa:** Middleware phân quyền kiểm tra cứng chuỗi role (hard-code). Khi thêm role `moderator` thì bắt buộc phải tạo tiếp hàm `isModerator` và cập nhật hàng loạt Router.

```javascript
// TRƯỚC — auth.mdw.js: hard-code role (OCP violation)
export function isSeller(req, res, next) {
  if (req.session.authUser.role === "seller") next();
  else res.render("403");
}
```

- **Sau khi sửa:** Phân tách logic cứng thành Ma trận phân quyền (`RolePermissions` Map). Các route sẽ không còn gọi `isSeller` hay `isAdmin` nữa, mà gọi trực tiếp hành động chúng cần bảo vệ, ví dụ: `requirePermission(Permissions.CREATE_PRODUCT)`. Cấu trúc này mở rộ cho mọi role mới sinh ra sau này mà không cần động đến code của Route hay Middleware.

```javascript
// SAU — src/utils/rbac.js
export const RolePermissions = {
  bidder: [PLACE_BID, ADD_WATCHLIST],
  seller: [
    PLACE_BID,
    ADD_WATCHLIST,
    CREATE_PRODUCT,
    EDIT_PRODUCT,
    VIEW_OWN_PRODUCTS,
  ],
  admin: [MANAGE_USERS, MANAGE_CATEGORIES, DELETE_PRODUCT],
};
export function hasPermission(role, permission) {
  return (
    role && RolePermissions[role] && RolePermissions[role].includes(permission)
  );
}
```

- **Kết hợp vá Bug:** Middleware `requirePermission` mới sửa luôn 2 lỗi ngầm trong hệ thống cũ: Tránh crash app khi `req.session.authUser = null` (chưa đăng nhập) và gắn đúng `res.status(403)` thay vì `res.render()` thông thường trả về mã 200.

> **Cập nhật Template:** Trong quá trình trên, hàng loạt Handlebars Helper (ví dụ: `time_remaining`, `or`, `and`, `eq`) đã được sinh ra để View Engine tự động hóa phân nhánh hiển thị, xóa sổ các khối logic thô rườm rà dưới Server Rendering. Xóa bỏ trùng lặp function khai báo. Lại một lần nữa chuẩn hóa format nháy kép và khối thụt lề cho toàn project.

### 3. Liskov Substitution Principle (LSP) - Nguyên lý Thay thế Liskov

**Định nghĩa:** Các đối tượng của lớp con phải có thể thay thế hoàn toàn cho các đối tượng của lớp cha mà không làm thay đổi tính đúng đắn của chương trình (không cần dùng `if` để kiểm tra kiểu của thực thể).

**❖ Vị trí vi phạm & Mã nguồn:**

- **Cập nhật Profile (`src/routes/account.route.js` - PUT `/profile`):** Router phải dùng `if (!currentUser.oauth_provider)` để né việc kiểm tra mật khẩu đối với tài khoản OAuth. Điều này cho thấy tài khoản OAuth không thể thay thế trơn tru cho tài khoản Local.

```javascript
router.put("/profile", isAuthenticated, async (req, res) => {
  const currentUser = await userModel.findById(currentUserId);

  // Kiểm tra trực tiếp loại user trong router -> VI PHẠM LSP
  if (!currentUser.oauth_provider) {
    if (
      !old_password ||
      !bcrypt.compareSync(old_password, currentUser.password_hash)
    ) {
      return res.render("vwAccount/profile", {
        err_message: "Password is incorrect!",
      });
    }
  }
  // ...
});
```

- **Logic ẩn sản phẩm đã kết thúc (`product.route.js`):** Ép định danh người dùng phải thuộc 2 loại cố định mới được xem (`if (!isSeller && !isHighestBidder)`), chặn đứng khả năng mở rộng cho class CS/Admin sau này.

**❖ Giải pháp:** Áp dụng **Strategy Pattern** cho việc cập nhật profile. Khởi tạo `IdentityProviderFactory` để trả về `LocalIdentityProvider` hoặc `OAuthIdentityProvider`. Mỗi Strategy sẽ tự định nghĩa hàm `validateProfileUpdate` riêng, giúp Router không cần quan tâm đến kiểu User nữa.

**❖ Minh chứng & Kết quả Refactor:**
_Khắc phục lỗi chia cắt phân nhánh User và mở rộng quyền Admin bằng RBAC._

**1. Tạo Mới `IdentityProvider` (Strategy Pattern)**

- **Trước khi sửa:** Route `PUT /profile` liên tục kiểm tra `!currentUser.oauth_provider` ở 3 cột mốc khác nhau (check pass cũ, check pass mới, build chuỗi save DB) chỉ để chắp vá logic cho tài khoản đăng ký bằng Local. Đỉnh điểm if-else lên tới ~40 dòng.

```javascript
// TRƯỚC — account.route.js, PUT /profile
if (!currentUser.oauth_provider) {
  if (!old_password || !bcrypt.compareSync(...)) { /* Lỗi password */ }
}
//... lại check oauth_provider tiếp lúc save DB
```

- **Sau khi sửa:** Implement Base class `IdentityProvider` cùng 2 Subclasses: `LocalIdentityProvider` và `OAuthIdentityProvider`. Logic ở Route được tinh giản triệt để chỉ còn 4 bước thông qua trung gian `IdentityProviderFactory` (Giảm hoàn toàn việc rẽ nhánh).

```javascript
// SAU — account.route.js, PUT /profile
// 1. CHỌN STRATEGY XỬ LÝ
const identityProvider = IdentityProviderFactory.getProvider(currentUser);
// 2. VALIDATE (Mỗi subclass tự biết phải check password hay bypass)
identityProvider.validateProfileUpdate(currentUser, req.body);
// 3. BUILD ENTITY
const entity = identityProvider.prepareUpdateEntity(currentUser, req.body);
```

**2. Bổ Sung RBAC: Quyền `VIEW_ALL_PRODUCTS` cho Admin**

- **Trước khi sửa:** Lỗi Liskov thứ hai nằm ở việc các route tĩnh của sản phẩm (như `GET /detail`) ép cứng đối tượng xem phải thuộc 2 loại cố định (`isSeller` hoặc `isHighestBidder`), chặn đường thêm các chức năng quản trị sau này.

```javascript
// TRƯỚC — product.route.js, GET /detail
if (!isSeller && !isHighestBidder) return res.status(403).render("403");
```

- **Sau khi sửa:** Mở rộng quyền năng của hệ thống cấp quyền RBAC (từ minh chứng trước) để bổ sung thêm Permission `VIEW_ALL_PRODUCTS` cấp phát độc quyền cho hệ quản trị (Role: `admin`). Admin bay giờ có thể bypass điều kiện ngặt nghèo của seller/bidder.

```javascript
// SAU — Mở rộng điều kiện an toàn
const role = req.session.authUser?.role;
const canViewAll = hasPermission(role, Permissions.VIEW_ALL_PRODUCTS);

if (!isSeller && !isHighestBidder && !canViewAll) {
  return res.status(403).render("403");
}
```

### 4. Interface Segregation Principle (ISP) - Nguyên lý Phân tách Interface

**Định nghĩa:** Không nên ép buộc Client phụ thuộc vào các module/hàm mà chúng không thực sự sử dụng.

**❖ Vị trí vi phạm & Mã nguồn:**

- **God Model `src/models/product.model.js`:** File dài gần 1000 dòng chứa hơn 20 hàm pha trộn đủ mọi nghiệp vụ (Admin, truy vấn trang chủ, seller thống kê, FTS search...).

```javascript
// Fat Interface
export function findAll() { ... }
export function findTopEnding() { ... }          // dùng cho home
export function countProductsBySellerId(..){ ... } // dùng cho seller
export async function getSellerStats(sellerId){ ... }// dùng cho seller

```

- **Client bị ảnh hưởng (`src/routes/home.route.js`):** Dù chỉ cần 3 hàm cho trang chủ, route này vẫn phải import toàn bộ cục module khổng lồ trên.

**❖ Đánh giá tác động:** Vi phạm ISP khiến code dễ bị Merge Conflict khi làm việc nhóm. Thay đổi logic của Seller có nguy cơ làm lỗi logic của trang chủ.
**❖ Giải pháp:** Phân tách module theo nhóm chức năng thực tế:

1. `product.model.js` (Chỉ chứa lệnh Write: thêm, sửa, xoá).
2. `product.catalog.model.js` (Chứa lệnh Read: hiển thị, tìm kiếm).
3. `seller.analytics.model.js` (Chỉ dùng riêng cho route thống kê của Seller).

**❖ Minh chứng & Kết quả Refactor:**
_Tách God Model gần 1000 dòng thành 3 Model chuyên biệt với nhiệm vụ rõ ràng, giảm tải Dependency cho các Route._

**1. Tạo mới `product.catalog.model.js` (Bóc tách logic Read/View)**

- **Mô tả:** Tách gần 15 module chuyên hiển thị dữ liệu sang catalog. Bao gồm các hàm phục vụ User & Admin (VD: Phân trang `findPage`, Tìm kiếm `searchPageByKeywords`, Home Page `findTopPrice`, Chi tiết sản phẩm `findByProductId2`).

```javascript
// SAU — product.catalog.model.js
// Các route Homepage và Product Listing sẽ gọi vào đây thay vì Model gốc
export async function findByProductId2(productId, userId) {
  // Query khổng lồ leftJoin 5 bảng, map sub_images và mask tên bidder
}
```

**2. Tạo mới `seller.analytics.model.js` (Bóc logic Dashboard)**

- **Mô tả:** Bóc tách toàn bộ function tính toán và thống kê dành riêng cho màn hình của Seller (Người bán) để code CRUD gốc không bị rác.

```javascript
// SAU — seller.analytics.model.js
export async function getSellerStats(sellerId) {
  // Dùng Promise.all() chạy song song 7 queries để tăng Performance:
  // countProducts, countActive, sold, pending, expired, doanh thu...
}
```

**3. Làm gọn `product.model.js` & Cập nhật các Route Client**

- **Mô tả:** Sau khi bóc tách 2 phần trên, `product.model.js` hiện tại đúng nghĩa là bản thiết kế của _Repository_ chuyên trách Thao tác Ghi (CRUD - Insert, UpdateThumbnail, Delete, Cancel).
- **Update 4 Routes:**
  - `home.route.js`: Đổi Import hoàn toàn sang `productCatalogModel`. Route trang chủ không còn phải cõng thêm hàng tá query của Seller hay Admin.
  - `product.route.js`: Map 8 vị trí gọi hàm Search/List sang biến tên miền Catalog mới.
  - `admin/product.route`: Chuyển 4 lần gọi Admin List sang Catalog.
  - `seller.route`: Import và xài `sellerAnalyticsModel` thay vì mix chung.

> **Lưu ý Bug / Formatting:** Vẫn còn tàn dư của `findByProductId2` đang gọi từ `productModel` ở route append-description (có thể là chủ đích chưa sửa hoặc là bug chưa nhận ra). Thêm vào đó, ở round refactor này toàn bộ API/Route đã được thống nhất: **Nháy kép, khoảng trắng Header thụt vào 2 spaces, Trailing Commas**.

### 5. Dependency Inversion Principle (DIP) - Nguyên lý Đảo ngược phụ thuộc

**❖ Vị trí vi phạm:**
Các file Controller (`src/routes/*.js`) phụ thuộc trực tiếp vào các thư viện ngoại vi (như `bcryptjs`, Mailer cứng) và các file Model phụ thuộc cứng vào Database Adapter `knex.js`.
**❖ Đánh giá tác động:** Tuyệt đối không thể viết Unit Test vì không thể mock (giả lập) Database Adapter hoặc Mailer một cách an toàn. Rất khó để đổi Database (VD từ PostgreSQL sang MongoDB) trong tương lai.
**❖ Giải pháp:** Áp dụng **Dependency Injection (DI)**. Truyền Database Adapter thông qua constructor của Model thay vì import trực tiếp bên trong file.

**❖ Minh chứng & Kết quả Refactor:**
_Khắc phục lỗi Tightly Coupled bằng Dependency Injection (DI) Container và Constructor Injection._

**1. Tạo DI Container (`src/utils/di.container.js`)**

- **Mô tả:** Chứa kho lưu trữ chung, cho phép Controller và Model truy vấn Dependency (như thư viện băm, bộ gửi mail) mà không cần require cứng ngắc.

```javascript
export default class Container {
  constructor() {
    this.services = new Map();
  }
  register(name, dependency) {
    this.services.set(name, dependency);
  }
  resolve(name) {
    return this.services.get(name);
  }
}
```

**2. Tạo Provider Wrappers (Bọc thư viện ngoài)**

- **Mô tả:** Abstract hóa các thư viện cứng như `bcrypt` và `nodemailer` thành những Service độc lập. Điều này giúp dễ dàng Mock Testing hoặc thay đổi thư viện gốc (Ví dụ đổi từ Bcrypt sang Argon2) mà không làm vỡ logic của Router.
- **`CryptoProvider`:** Chứa hàm async `hash()` và `compare()`. Bọc lấy `bcryptjs`.
- **`EmailProvider`:** Bọc cấu hình SMTP thành hàm duy nhất `send()`.

**3. Refactor UserModel theo hướng Constructor Injection**

- **Trước khi sửa:** Model import DB Client (`knex.js`) thẳng cánh trên cùng của file, tất cả mọi module bị khóa chặt chết vào kho dữ liệu tĩnh này. Thất bại khi muốn Test thử nghiệm bằng In-Memory DB.
- **Sau khi sửa:** Chuyển hóa toàn bộ function cũ dồn vào Class `UserModel`. Cơ sở dữ liệu được "Bơm" (Inject) vào từ Constructor lúc khởi tạo ứng dụng (`this.db = db;`).
- **Tương thích ngược (Backward Compatibility):** File xuất sẵn (export default) một instance dùng chung `defaultUserModel` cộng thêm các hàm bind sẵn. Việc này bảo vệ 100% các file cũ chưa kịp ứng dụng DI (như Review, Watchlist Route) không bị gãy vỡ (Crash).

```javascript
// Cú pháp cứu tinh 15 methods không làm gãy codebase cũ:
export const findById = defaultUserModel.findById.bind(defaultUserModel);
```

**4. Ứng dụng DI vào Router (`createAccountRouter`)**

- **Mô tả:** Thay thế Router cổ điển (Singleton Router) thành dạng Factory Pattern `createAccountRouter(container)`. Ngay khi index.js gọi nó và truyền hệ thống DiContainer vào, nó sẽ lập tức tự nhồi nhét `CryptoProvider` và `EmailProvider` vào cho Account làm việc.

```javascript
// SAU — src/routes/account.route.js
export default function createAccountRouter(container) {
  const router = express.Router();
  const cryptoService = container.resolve('CryptoProvider');

  // Router xài biến Abstract:
  const hashedPassword = await cryptoService.hash(new_password);

  return router;
}
```

> **Lưu ý / Sót lỗi:** Việc áp dụng `EmailProvider` còn sót duy nhất ở route `POST /signin` khi tài khoản chưa verify, chốn đó vẫn gọi thẳng cẳng `sendMail()` cũ. Đoạn mã `index.js` có dính lỗi cú pháp khi gọi phép `import` ngay ngai ở cấp hàm tĩnh (Block scope) thay vì đỉnh File (Top-level) — dễ khiến app sập nguồn khi chạy trực tiếp.

---

## II. Nguyên lý DRY (Don't Repeat Yourself)

**Định nghĩa:** Mỗi đoạn logic/tri thức trong hệ thống chỉ nên có một điểm định nghĩa (Single Source of Truth) duy nhất.

### 1. Lặp lại truy vấn SQL (Raw Query)

**❖ Vị trí vi phạm:** File `src/models/product.catalog.model.js`.
Logic đếm lượt đấu giá (`bid_count`) và ẩn tên người đấu giá (`bidder_name`) bị copy-paste y hệt ở hơn 10 hàm khác nhau.

```javascript
// Xuất hiện trong findAll, searchPageByKeywords, findByCategoryId, v.v...
.select(
  'products.*',
  db.raw(`mask_name_alternating(users.fullname) AS bidder_name`), // LẶP LẠI
  db.raw(`
    ( SELECT COUNT(*) FROM bidding_history WHERE bidding_history.product_id = products.id ) AS bid_count
  `) // LẶP LẠI
)

```

**❖ Giải pháp:** Trích xuất các đoạn SQL này thành các Hằng số (Constants) hoặc mảng Selectors tái sử dụng ở đầu file.

```javascript
const MASK_BIDDER_NAME_QUERY = db.raw(
  `mask_name_alternating(users.fullname) AS bidder_name`,
);
const PRODUCT_SUMMARY_SELECTORS = [
  "products.*",
  MASK_BIDDER_NAME_QUERY,
  BID_COUNT_QUERY,
];
// Sau đó chỉ việc gọi .select(...PRODUCT_SUMMARY_SELECTORS)
```

**❖ Minh chứng & Kết quả Refactor:**
_Khắc phục lỗi copy-paste SQL thô lặp lại nhiều lần bằng hằng số Selector._

- **Vấn đề cũ:** Trong file `product.catalog.model.js`, có 2 đoạn SQL raw đếm số lượt bid và che giấu tên người dùng hiển thị (mask name) bị vất vưởng lặp lại ở hơn 8 vị trí hàm khác nhau (từ `findAll`, tới `searchPageByKeywords`, `findByCategoryId`, vân vân). Nếu logic mask name thay đổi, lập trình viên sẽ phải sửa lại bằng tay ở 8 hàm này.
- **Sau khi sửa:** Trích xuất 2 khối lệnh raw thành biến export hằng số, đồng thời gom nhóm chúng vào mảng dùng chung `PRODUCT_SUMMARY_SELECTORS`. Giờ đây, thay vì viết lại hàng chục dòng SQL Raw, các hàm chỉ cần rải (Spread Opertor) chuỗi này vào lệnh `select` của Knex.js.

```javascript
// TRƯỚC (Lặp lại 3 dòng SQL thủ công)
.select(
  "products.*",
  db.raw(`mask_name_alternating(users.fullname) AS bidder_name`),
  db.raw(`(SELECT COUNT(*) FROM bidding_history WHERE ...) AS bid_count`)
)

// SAU (Gọn gàng 1 dòng và thống nhất 100%)
.select(...PRODUCT_SUMMARY_SELECTORS)

// NẾU CẦN THÊM CỘT NÂNG CAO (Rải biến giữa chừng)
.select(
  ...PRODUCT_SUMMARY_SELECTORS,
  "categories.name as category_name",
  db.raw("watchlists.product_id IS NOT NULL AS is_favorite")
)
```

- **Kết quả:** 10 vị trí hàm bao gồm `findPage`, `searchPage`, các hàm Home Page (`findTopEnding`, `findTopPrice`) đều được chuẩn hóa gọi qua hằng số khai báo tập trung. Đoạn mã giảm đi hàng chục dòng text vô giá trị và tuyệt đối giảm thiểu bug do sửa sót tính năng.

### 2. Lặp lại nghiệp vụ tạo OTP và gửi Email

**❖ Vị trí vi phạm:** File `src/routes/account.route.js`.
Luồng sinh OTP, lưu DB và gửi Email bị sao chép ở 6 route khác nhau (Quên mật khẩu, Đăng ký, Đăng nhập, Gửi lại mã...).

```javascript
const otp = Math.floor(100000 + Math.random() * 900000).toString();
const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
await userModel.createOtp({ ...otpData });
await sendMail({ to: email, html: `...${otp}...` });
```

**❖ Giải pháp:** Tạo một Service/Helper dùng chung `async function generateAndSendOtp(user, purpose, subject, templateText)`. Nếu sau này muốn đổi thời hạn OTP thành 5 phút, chỉ cần sửa đúng ở một chỗ duy nhất.

**❖ Minh chứng & Kết quả Refactor:**
_Khắc phục lỗi lặp lại code khối khởi tạo và gửi OTP ở 4 Route khác nhau._

- **Vấn đề cũ:** Tại `account.route.js`, cùng một khối logic dài `15 dòng` (sinh OTP, tính toán hàm hash, gắn DB, khởi tạo nội dung Email tĩnh) bị copy và dán vào 4 chỗ: `POST /forgot-password`, `POST /resend-forgot-password-otp`, `POST /signin`, và `POST /resend-otp`.
- **Sau khi sửa:** Trích xuất đoạn mã này thành Helper Function `generateAndSendOtp()` nằm trong nội bộ File Router. Bằng cách gán Closure, hàm này dễ dàng tái sử dụng đối tượng `userModelDb` và `emailService` đang có sẵn.

```javascript
// TRONG THÂN ROUTER FACTORY
async function generateAndSendOtp(user, purpose, subject, emailTemplateText) {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await userModelDb.createOtp({
    user_id: user.id,
    otp_code: otp,
    purpose,
    expires_at: expiresAt,
  });

  // Render template text sử dụng {{otp}} placeholder
  await emailService.send({
    to: user.email,
    subject: subject,
    html: `<p>Hi ${user.fullname},</p>${emailTemplateText.replace("{{otp}}", otp)}<p>This code will expire in 15 minutes.</p>`,
  });
  return otp;
}

// ROUTE SỬ DỤNG (Rút ngắn còn 4 dòng)
await generateAndSendOtp(
  user,
  "verify_email",
  "Verify your Online Auction account",
  "<p>Your OTP code is: <strong>{{otp}}</strong></p>",
);
```

- **Kết quả đạt được:** Tận diệt lượng lớn mã rỗng (khoảng 40 dòng) nhờ cơ chế thay thế String Placeholder `{{otp}}`. Song song đó, route `POST /signin` vô tình cũng được vá luôn một lỗi lắt nhắt sót lại trước đây là nó gọi lén `sendMail()` thay vì gọi DI `emailService`.

### 3. Lặp lại thuật toán tính toán phân trang

**❖ Vị trí vi phạm:** File `src/routes/product.route.js` và `src/routes/account.route.js`. Logic toán học (`nPages`, `from`, `to`) bị sao chép ở mọi endpoint cần phân trang.
**❖ Giải pháp:** Tách thành Utility Function `calculatePagination(totalCount, page, limit)` nằm gọn trong `src/utils/paginationHelper.js`.

**❖ Minh chứng & Kết quả Refactor:**
_Khắc phục lỗi lặp lại thuật toán phân trang bằng Utility Function độc lập._

- **Vấn đề cũ:** Logic toán học thuần túy dài gần 10 dòng (tính tổng số trang `nPages`, chặn giới hạn min max `from`/`to`...) nằm lặp lại y hệt ở các endpoint của `product.route.js` và `account.route.js`.
- **Sau khi sửa:** Đóng gói đoạn mã này thành hàm chuẩn `calculatePagination()` duy nhất. Hàm này được bổ sung độ an toàn nhờ ép kiểu số nguyên `parseInt(totalCount) || 0` ngay từ đầu để chống lỗi do chuỗi rác nhập vào.

```javascript
// SAU — src/utils/paginationHelper.js
export function calculatePagination(totalCount, page, limit) {
  const parsedTotal = parseInt(totalCount) || 0;
  const nPages = Math.ceil(parsedTotal / limit);
  let from = (page - 1) * limit + 1;
  let to = page * limit;

  if (to > parsedTotal) to = parsedTotal;
  if (parsedTotal === 0) {
    from = 0;
    to = 0;
  }

  return {
    totalCount: parsedTotal,
    totalPages: nPages,
    from,
    to,
    currentPage: page,
  };
}

// ROUTE SỬ DỤNG (Rút gọn từ 10 dòng còn 2 dòng)
const paginationData = calculatePagination(totalCount, page, limit);
res.render("vwAccount/watchlist", {
  products: watchlistProducts,
  ...paginationData, // Spread tất cả: totalCount, from, to, currentPage, totalPages
});
```

- **Kết quả đạt được:** Tối giản hóa code của 2 route lớn. Chỉ bằng 1 hàm phụ trợ và 1 toán tử rải object `...paginationData`, code render template trở nên vô cùng nhàn rỗi và sạch sẽ.

---

## III. Nguyên lý KISS (Keep It Simple, Stupid)

**Định nghĩa:** Hệ thống hoạt động tốt nhất khi nó được giữ đơn giản, tránh lồng ghép logic rườm rà.

### 1. God Function / Spaghetti Route

**❖ Vị trí vi phạm:** Hàm xử lý `POST /bid` trong `src/routes/product.route.js` (hơn 450 dòng mã liên tục).
**❖ Vấn đề:** Nhồi nhét Transaction Database, hàng loạt `if-else` lồng nhau để chạy Automatic Bidding, và xen lẫn việc tạo chuỗi HTML gửi mail trực tiếp ở cuối hàm. Rất khó bảo trì và bất khả thi khi viết Unit Test.
**❖ Giải pháp:** Dùng **Facade Pattern** hoặc chia kiến trúc **Service-Layer**. Route chỉ nhận `req` và gọi `BiddingService.placeBid(...)`. Việc gửi Email nên đẩy vào hệ thống Event-driven (Ví dụ: `EventEmitter.emit('BID_PLACED')`).

**❖ Minh chứng & Kết quả Refactor:**
_Khắc phục lỗi ôm đồm logic bằng Service-Layer và xử lý Mail bất đồng bộ._

**1. Tạo Mới `BiddingService` (Tách core logic)**

- **Trước khi sửa:** Route handler ôm toàn bộ DB transaction, validation, auto-bidding và gửi mail (~250 dòng).

```javascript
// TRƯỚC — product.route.js (route handler ôm hết logic)
router.post("/bid", isAuthenticated, async (req, res) => {
  const result = await db.transaction(async (trx) => {
    // 1. Lock product row...
    // 2. Auto-bidding calculation (Case 0/1/2a/2b/2c)...
    // ~250 dòng code ...
  });
});
```

- **Sau khi sửa:** Toàn bộ logic đặt giá được tách vào `BiddingService.placeBid()`, sinh luôn message nội vi. Route trở nên vô cùng sạch sẽ chỉ với 3 bước (nhận request -> gọi service xử lý -> gọi báo cáo). Đồng thời, **fix luôn bug tiềm ẩn** bằng cách thêm fallback default values (`triggerMinutes = settings?.auto_extend_trigger_minutes || 5;`) để tránh lỗi null từ DB.

```javascript
// SAU — product.route.js (route sạch, gọi service)
router.post("/bid", isAuthenticated, async (req, res) => {
  try {
    // 1. Core Logic handled by BiddingService
    const result = await BiddingService.placeBid(productId, userId, bidAmount);

    // 2. Notification handled asynchronously
    NotificationService.sendBidNotifications(result, hostContext);

    // 3. User feedback
    req.session.success_message = result.message;
    res.redirect(`/products/detail?id=${productId}`);
  } catch (error) { ... }
});
```

**2. Tạo Pure Function cho Thuật toán Bidding (`Bidding Algorithm`)**

- **Vấn đề cũ:** Bên trong chính `BiddingService`, các logic tính toán giá tự động (Business Logic dài ~70 dòng) vẫn bị trộn lẫn một mớ hỗn độn với các lệnh thao tác tương tác Cơ sở dữ liệu, khiến việc kiểm thử Unit Test trở thành ác mộng.
- **Sau khi sửa:** Tách hẳn đoạn toán học logic này thành một Cấu trúc hàm thuần khiết (Pure Function) tên là `calculateNewBidState(state, action)` ở file `src/services/bidding.algorithm.js`.
  Hàm này tuyệt đối không có Side Effect, không chạm vào Database, chỉ tính toán và trả ra State mới nhất (Giá hiện tại, Người thắng, Buộc kết thúc Buy Now...).

```javascript
// SAU - src/services/bidding.algorithm.js
export function calculateNewBidState(state, action) {
  const { product, buyNowPrice, currentPrice, minIncrement } = state;
  const { userId, bidAmount } = action;

  // Xử lý Case 0/1/2a/2b/2c bằng logic toán học thuần túy
  if (
    buyNowPrice &&
    product.highest_bidder_id &&
    product.highest_bidder_id !== userId
  ) {
    if (currentHighestMaxPrice >= buyNowPrice) {
      newCurrentPrice = buyNowPrice; // First-come-first-served
      newHighestBidderId = product.highest_bidder_id;
      buyNowTriggered = true;
    }
  }
  // ...
  return {
    newCurrentPrice,
    newHighestBidderId,
    newHighestMaxPrice,
    shouldCreateHistory,
    productSold,
  };
}

// BiddingService GỌI HÀM (Clean, dễ đọc)
const { newCurrentPrice /*...*/ } = calculateNewBidState(
  { product, buyNowPrice, currentPrice, minIncrement },
  { userId, bidAmount },
);
```

**2. Tạo Mới `NotificationService` (Tách side-effect)**

- **Vấn đề cũ:** Chèn khối HTML dài hàng trăm dòng và `await sendMail()` ngay giữa luồng chính, block tốc độ response của người dùng.
- **Sau khi sửa:** Tách vào `src/services/notification.service.js`. Khởi chạy hàm thông qua dạng IIFE bất đồng bộ (Fire-and-Forget) giúp response mạng mượt mà, không bắt người dùng chờ gửi 3 cái email (Seller, Current Bidder, Previous Bidder).

```javascript
// Fire and forget — không await trong main flow
(async () => {
  try {
    if (emailPromises.length > 0) await Promise.all(emailPromises);
  } catch (emailError) {
    console.error("Failed to send bid notification emails:", emailError);
  }
})();
```

> **Lưu ý Code Style:** Trong đợt refactor này, toàn bộ codebase cũng được chuẩn hóa: đổi Single-quote thành Double-quote (Prettier chuẩn), thêm trailing comma, và wrap gọn gàng các block `if/else` để tránh sai sót cú pháp diện rộng.

### 2. Callback Hell / Nested Logic trong Knex

**❖ Vị trí vi phạm:** File `src/models/autoBidding.model.js` (hàm `getWonAuctionsByBidderId`).
**❖ Vấn đề:** "Kim tự tháp" callback lồng nhau quá sâu để tạo mệnh đề `(A AND B) OR C`.

```javascript
.where(function() {
  this.where(function() {
    this.where(function() {
      this.where('products.end_at', '<=', new Date()).orWhereNotNull('products.closed_at');
    }).whereNull('products.is_sold');
  }).orWhere('products.is_sold', true).orWhere('products.is_sold', false);
})

```

**❖ Giải pháp:** Chuyển sang dùng Raw SQL thuần `whereRaw` cho các mệnh đề quá phức tạp, hoặc bóc tách các điều kiện thành các biến hàm Boolean riêng biệt để tự tài liệu hóa code.

**❖ Minh chứng & Kết quả Refactor:**
_Khắc phục lỗi lồng ghép Callback 3 cấp để code query trở nên mạch lạc như ngôn ngữ tự nhiên._

- **Vấn đề cũ:** Tại hàm `getWonAuctionsByBidderId` (hoặc các hàm tính toán trạng thái tương tự), để tạo ra được mệnh đề `(A AND B) OR C`, lập trình viên đã dùng Knex.js khởi tạo _Kim tự tháp_ callback `this.where(function() { ... })` lồng nhau đến 3 cấp độc hại. Ngữ nghĩa của truy vấn SQL bị che khuất rườm rà phía dưới những cấu trúc hàm nặc danh (anonymous function) khó phân tích.
- **Sau khi sửa:** Cách ly cụm điều kiện bên trong (điều kiện về sản phẩm Pending: Đã hết giờ hoặc đóng nhưng chưa bán) thành một Variable Named Function riêng biệt mang tên `isPendingCondition`.

```javascript
// SAU - src/routes/product-order.route.js (Tách biến đệm)
const isPendingCondition = builder => {
  builder.where(function () {
    this.where('products.end_at', '<=', new Date())
      .orWhereNotNull('products.closed_at');
  }).whereNull('products.is_sold');
};

// ÁP DỤNG (Cấu trúc mạch lạc, không lồng 3 cấp)
.andWhere(function () {
  this.where(isPendingCondition)      // Đọc như ngôn ngữ tự nhiên !
    .orWhere('products.is_sold', true)
    .orWhere('products.is_sold', false);
})
```

- **Kết quả đạt được:** Logic nghiệp vụ 100% không đổi, nhưng code từ dạng hỗn loạn "spaghetti" nay đã trở thành cấu trúc tuyến tính rành mạch, dễ hiểu đối chứng ngay với mệnh đề tiếng Anh tự nhiên.

### 3. Viết mã HTML thô (Hard-coded) trong Controller

**❖ Vị trí vi phạm:** API Chat ở `src/routes/product.route.js`.
**❖ Vấn đề:** Dùng vòng lặp cộng dồn biến chuỗi để sinh HTML trả về cho client. Vi phạm phân tách tầng giao diện (MVC), khó debug thẻ HTML và nguy cơ dính lỗ hổng **XSS (Cross-Site Scripting)** cao vì không có cơ chế escape kí tự đầu vào.

```javascript
let messagesHtml = "";
messages.forEach((msg) => {
  messagesHtml += `<div class="chat-message"><div class="chat-bubble">${msg.message}</div></div>`;
});
```

**❖ Giải pháp:** API chỉ nên trả về dữ liệu thuần (JSON). Nếu bắt buộc render HTML từ server, hãy sử dụng `res.render` (Handlebars Partial Templates) để hệ thống view tự động quản lý bảo mật XSS.

**❖ Minh chứng & Kết quả Refactor:**
_Khắc phục lỗi mã HTML thô nhúng trong Controller, đồng thời tận diệt Lỗ hổng XSS nguy hiểm._

- **Vấn đề cũ:** Trong chức năng Chat tin nhắn giữa Buyer/Seller, Controller gom biến String ghép lại thẻ `<div class="chat-message">` rồi trả nguyên cục chuỗi HTML cho client để gắn vào `innerHTML`. Lập trình viên vi phạm trầm trọng quy tắc phân lớp vì Controller đang làm thay công việc của giao diện (View). Đáng sợ hơn, vì không có hàm sanitize đặc biệt, nếu tin nhắn điền là đoạn text `<script>alert('hacked')</script>`, trình duyệt sẽ kích hoạt ngay mã lệnh đó (Tấn công XSS).
- **Sau khi sửa:** Đưa API trở về đúng chức năng của kiến trúc REST là cung cấp Pure JSON: `res.json({ data: messages_array })`. Giao luôn việc render thẻ DIV về Client thông qua JS DOM. Trong JS Client, bổ sung thêm hàm khử tĩnh điện ký tự (Escape) cực kỳ nghiệm ngặt `escapeHtml(unsafe)`.

```javascript
// TRƯỚC - Server ôm đồm render HTML dính XSS
res.json({
  success: true,
  messagesHtml: "<div class='chat-message'>...</div>",
});
chatMessages.innerHTML = messagesData.messagesHtml || "";

// SAU - Tại Server: Khôi phục kiến trúc chuẩn Pure JSON
res.json({
  success: true,
  data: messages.map((msg) => ({
    message: msg.message,
    isSent: msg.sender_id === userId,
  })),
});

// SAU - Tại Client: Viết hàm an toàn và hứng JSON tự vẽ giao diện
const escapeHtml = (unsafe) => {
  return (unsafe || "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};
const safeMessage = escapeHtml(msg.message); // Sanitize 100% trước khi vẽ
```

- **Kết quả đạt được:** Tách biệt rạch ròi Concerns giữa Back-end và Front-end (KISS). XSS tuyệt đối vô hại, đoạn Script độc ác khi xuống trang View sẽ bị biến thành đoạn text thuần túy: `&lt;script&gt;alert('hacked')&lt;/script&gt;`.

### 4. Logic Helper rườm rà không cần thiết

**❖ Vấn đề:** Hàm `mask_name` sử dụng hàng tá khối lặp `for`, check độ dài bằng `if-else` dài dòng chỉ để che tên người dùng. Trong khi đó hoàn toàn có thể dùng các phương thức functional tích hợp sẵn của JavaScript (`split`, `pop`) để giải quyết chỉ trong 1-2 dòng code.

---

## IV. Nguyên lý YAGNI (You Aren't Gonna Need It)

**Định nghĩa:** Không thiết kế và không viết code cho những tính năng "có thể cần trong tương lai". Chỉ viết những gì ứng dụng đang thực sự dùng hiện tại.

### 1. Dead Code trong System Settings & Các Model khác

**❖ Vị trí vi phạm:** File `src/models/systemSetting.model.js`, `order.model.js`, `invoice.model.js`.
**❖ Vấn đề:** Lập trình viên theo thói quen tạo đủ một bộ CRUD "dự phòng". Trong Setting có 5 hàm thì ứng dụng chỉ xài 1. Trong Order và Invoice có hơn 20 hàm thì khoảng 60% (hơn 200 dòng code) là chưa từng được gọi ở đâu trong Project.
**❖ Đánh giá:** Tốn thời gian maintain những đoạn mã chết, gây hiểu lầm cho người tiếp quản dự án về thiết kế kiến trúc hiện tại.
**❖ Giải pháp:** Xóa ngay lập tức mọi đoạn code chết! Chỉ viết thêm khi nào có chức năng (như giao diện Admin) thực sự cần gọi tới chúng.

**❖ Minh chứng & Kết quả Refactor:**
_Khắc phục lỗi Tàn dư code cấu hình (Settings) dự phòng không bao giờ tới tay._

- **Vấn đề cũ:** Trong file `src/models/systemSetting.model.js`, lập trình viên đã viết sẵn một bộ 5 hàm (như `getAllSettings`, `updateSetting(key, value)`, `editNewProductLimitMinutes`...). Tuy nhiên, qua quá trình rà soát, ứng dụng hiện tại **hoàn toàn không có Giao diện Quản trị Cấu hình (Admin Settings Panel)**. Việc giữ lại 4/5 hàm này (dài hơn 30 dòng SQL) là hoàn toàn dư thừa và vi phạm chuẩn YAGNI.
- **Sau khi sửa:** Quét sạch toàn bộ 4 hàm không dùng đến. File cấu hình giờ đây tinh gọn tối đa, chỉ giữ lại duy nhất 1 hàm `getSettings()` phục vụ việc lấy cấu hình chung cho tính toán Backend.

```javascript
// TRƯỚC - Dư thừa 4 hàm không hề được Trigger ở Controller nào cả
export function getAllSettings() { ... }
export function getSetting(key) { ... }
export function updateSetting(key, value) { ... }
export function editNewProductLimitMinutes(minutes) { ... }

// SAU - Chỉ giữ lại duy nhất nhu cầu thực tiễn
export function getSettings() {
    return db('system_settings').first();
}
```

- **Kết quả đạt được:** Tối ưu hóa dung lượng Source Code. Lập trình viên đi sau nhìn vào file `systemSetting.model.js` sẽ hiểu ngay lập tức Model này chỉ có vai trò Read-Only (Chỉ đọc) ở bối cảnh kiến trúc hiện hành.

_Dọn dẹp triệt để các hàm dự phòng (Dead Code) trong Order và Invoice Model._

- **Vấn đề cũ:** Tại 2 file `src/models/invoice.model.js` và `src/models/order.model.js`, có hơn 15 hàm bị viết "dành để dành", không hề được Frontend nào gọi tới (điển hình như `hasPaymentInvoice(orderId)` hay `canUserAccessOrder(orderId, userId)`). Sự sai lệch nằm ở chỗ logic bảo vệ Guard như `canUserAccessOrder` lại bị nhồi xuống tận Model Database, thay vì nhét ở Service Layer/Middleware.
- **Sau khi sửa:** Xóa thẳng tay toàn bộ ~200 dòng (hơn 60% file) logic dư thừa nằm chết trong cả 2 Model.

```javascript
// DƯ THỪA - Bị xóa sổ hoàn toàn khỏi invoice.model.js
export function findById(invoiceId) { ... }
export function hasPaymentInvoice(orderId) { ... }
export function getUnverifiedInvoices() { ... }
// ... và 4 hàm khác

// DƯ THỪA - Bị xóa sổ hoàn toàn khỏi order.model.js
export function findByIdWithDetails(orderId) { ... }
export async function canUserAccessOrder(orderId, userId) { ... } // Lỗi kiến trúc: Auth Guard nhét ở Model
export function countByStatus(userId, userType) { ... }
// ... và 6 hàm khác
```

- **Kết quả đạt được:** Giải phóng hàng đống dung lượng dư thừa, làm rạch ròi Context cho Model. Lập trình viên mới vào dự án sẽ không bị ngợp hay lạc lối khi cố tìm hiểu hàm `canUserAccessOrder` được route nào phụ trách gọi nữa.

### 2. Code và thư viện bị vô hiệu hóa (Twitter OAuth)

**❖ Vị trí vi phạm:** File `src/utils/passport.js` và `package.json`.
**❖ Vấn đề:** Viết sẵn 40 dòng code Strategy cho tính năng đăng nhập Twitter rồi... comment lại vì API yêu cầu trả phí. Tuy nhiên, thư viện `passport-twitter` vẫn được import và nằm chình ình trong `package.json`.
**❖ Đánh giá:** Tăng kích thước `node_modules` vô nghĩa và mở ra rủi ro bảo mật tiềm ẩn từ dependency không dùng đến (Attack surface).
**❖ Giải pháp:** Xóa sạch block code bị comment, xóa import, và gỡ bỏ gói thư viện khỏi `package.json`.

**❖ Minh chứng & Kết quả Refactor:**
_Xóa bỏ kịch bản cấu hình Twitter chết yểu và chuẩn hóa Format cho các kịch bản còn lại._

- **Vấn đề cũ:** Bên trong `src/utils/passport.js` có chứa 40 dòng code rác của `TwitterStrategy` bị comment lại (lý do vì API Twitter đã ngừng cung cấp free tier từ /2023). Tệ hơn, Library `passport-twitter` vẫn được gọi bằng lệnh import và nằm yên vị chiếm chỗ lưu trữ trong `package.json`. Kèm theo đó, callback của các thư viện như `GoogleStrategy` lại bị lùi lề (indent) cẩu thả ngang hàng với lệnh khai báo `passport.use`.
- **Sau khi sửa:** Ra lệnh xóa bỏ hoàn toàn module `passport-twitter` khỏi Terminal và loại bỏ sạch sẽ 40 dòng code comment không có giá trị tái sử dụng. Tái căn chỉnh lề (Indent 4 spaces) toàn bộ các Strategy còn lại (Google, Facebook, GitHub).

```javascript
// TRƯỚC - Callback ngang hàng khai báo cha, code thụt thò
passport.use(new GoogleStrategy({ ... },
async (accessToken, refreshToken, profile, done) => {
  // Indent 2 spaces chênh vênh...
}));

// SAU - Callback thụt lề chuẩn hóa trong GoogleStrategy()
passport.use(new GoogleStrategy({ ... },
    async (accessToken, refreshToken, profile, done) => {
        // Indent 4 spaces, Code sạch bóng, không dư dòng...
    }
));
```

- **Kết quả đạt được:** Quét sạch Rủi ro Bảo mật Tiềm ẩn (Attack Surface) gây ra bởi Dependency lỗi thời. File cấu hình Login giờ đây ngăn nắp, căn xưng chuẩn mực, dễ đọc và dễ mở rộng.

### 3. Hàm truy vấn phân trang cũ không bao giờ sử dụng

**❖ Vị trí vi phạm:** File `src/models/product.model.js`.
**❖ Vấn đề:** Hàm `findPage(limit, offset)` và hằng số truy vấn `BASE_QUERY` từng được dùng ở giai đoạn đầu để phân trang, nhưng hiện tại ứng dụng đã chuyển sang dùng các hàm tiên tiến hơn (`searchPageByKeywords`). Tuy nhiên, bản thân hàm cũ vẫn bị bỏ quên trong mã nguồn. Không có chỗ nào trong source code `grep "productModel.findPage"` gọi hàm này cả.
**❖ Giải pháp:** Xóa sạch hàm `findPage` và kiểm tra để refactor lại `BASE_QUERY` nhằm giữ cho Database Model luôn gọn nhẹ và chính xác với luồng chạy thực tế.

**❖ Minh chứng & Kết quả Refactor:**
_Ngăn chặn Bug tiềm ẩn sinh ra từ biến "Dành để dành" (BASE_QUERY) và hàm phân trang cũ (findPage)._

- **Vấn đề cũ 1 (Code thừa):** Cấu trúc cũ chứa hàm `findPage(limit, offset)` chuyên dành phục vụ việc phân trang sản phẩm sơ khai. Tuy nhiên khi ứng dụng dùng đến Search/Filter, tính năng này đã bị chiếm quyền kiểm soát bởi các hàm tiên tiến hơn (như `searchPageByKeywords`). Lệnh grep trong toàn dự án cho thấy hàm `findPage` chưa bao giờ được gọi.
- **Vấn đề cũ 2 (Bug tiềm ẩn từ biến "dành để dành"):** Trong file có khởi tạo 1 hằng số dùng chung tên là `BASE_QUERY` tích hợp thuộc tính `.where("end_at", ">", new Date())`. Biến số này là một đối tượng Khởi tạo 1 lần (Singleton). Điều này mang rủi ro cực lớn: `new Date()` chỉ được gọi 1 lần duy nhất lúc Node Server vừa bật lên. Nếu server chạy 3 ngày, `BASE_QUERY` vẫn lọc các sản phẩm của quá khứ (ngày đầu tiên) thay vì hiện tại!
- **Sau khi sửa:** Xóa sổ vĩnh viễn hàm `findPage` cùng cấu trúc `BASE_QUERY` dùng chung. Trả lại lệnh `where` gọi trực tiếp `new Date()` vào bên trong scope của từng hàm riêng biệt (như `findTopEnding` hay `findTopPrice`), đảm bảo dòng thời gian (Date constraint) luôn được tính tươi mới (Fresh Evaluate) mỗi khi Hàm được kích hoạt.

```javascript
// TRƯỚC - BASE_QUERY mang Bug về đánh giá thời gian new Date()
const BASE_QUERY = db("products").leftJoin(...)
  .where("end_at", ">", new Date())  // <-- NGẦY CŨ CỦA SERVER LÚC KHỞI ĐỘNG
  .limit(5);

// TRƯỚC - Hàm findPage dư thừa không bao giờ được trigger
export function findPage(limit, offset) { ... }

// SAU - Đập bỏ BASE_QUERY. Scope logic ngày tháng vào thẳng hàm query.
export function findTopEnding() {
  return db("products").leftJoin(...).select(...)
    .where("products.end_at", ">", new Date()) // <-- NGÀY TƯƠI MỚI NGAY LÚC GỌI HÀM!
    .whereNull("products.closed_at")     // Viết tường minh điều kiện
    .orderBy("end_at", "asc").limit(5);
}
```

- **Kết quả đạt được:** Tận diệt dứt điểm 1 bug nghiêm trọng mang tên _Mốc thời gian ảo hóa_ (Stale Date Evaluate) phát hành từ 1 biến `BASE_QUERY` được thiết kế theo tư duy YAGNI quá tay. Tối giảm đáng kể Logic thừa.

---
