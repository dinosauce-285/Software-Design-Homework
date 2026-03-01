# Báo Cáo Phân Tích Mã Nguồn: Vi Phạm SOLID, KISS, DRY, YAGNI

Dưới đây là báo cáo tổng hợp các vấn đề mã nguồn đã được xác định, gộp nhóm và đánh giá dựa trên các nguyên lý phát triển phần mềm chuẩn. Các đoạn **mã nguồn thực tế (Code Snippets)** đã được trích xuất và đính kèm trực quan dưới mỗi lỗi để làm dẫn chứng.

---

## I. Nguyên lý SOLID

### 1. Single Responsibility Principle (SRP) - Nguyên lý Đơn nhiệm

**❖ Tìm kiếm các vi phạm:**

- **Route POST `/bid` (trong `src/routes/product.route.js`):** Khối lệnh dài 250–400 dòng, gánh vác quá trình: phân tích HTTP Request, logic auto-bidding rẽ nhánh phức tạp, lock Database, định dạng HTML và gửi email bất đồng bộ.

```javascript
// src/routes/product.route.js
router.post("/bid", isAuthenticated, async (req, res) => {
  // ... 400 dòng logic phức tạp lồng ghép ...
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

- **Route POST `/signup` (trong `src/routes/account.route.js`):** Xử lý từ Validate input, gọi HTTP check Captcha, băm mật khẩu, lưu DB, đến định dạng và gửi Email.

```javascript
// src/routes/account.route.js
router.post("/signup", async function (req, res) {
  // 1. Validate Input thủ công
  // 2. HTTP Fetch check Captcha từ Google
  // 3. Hash mật khẩu (bcrypt)
  // 4. Lưu User vào Database
  // 5. Tạo OTP ngẫu nhiên
  // 6. Gửi Email HTML
});
```

**❖ Đánh giá tác động:** Các file này bị quá tải trách nhiệm, trở nên khó đọc, khó debug. Rủi ro cao làm hỏng core business (luồng giá cốt lõi hoặc luồng đăng ký) khi sửa đổi một tính năng nhỏ lẻ như giao diện email.
**❖ Đề xuất cải thiện:**

- Tách thành `BiddingService`/`AuthService`. Các module Validation / API check Captcha / Gửi email sẽ tách thành Middleware và Service vệ tinh.

---

### 2. Open/Closed Principle (OCP) - Nguyên lý Mở rộng/Đóng gói

**❖ Tìm kiếm các vi phạm:**

- **Logic Quản trị Trạng thái Sản phẩm (`product.route.js`):** Không có cột `status` trong DB. Trạng thái được định tuyến bằng vô số lệnh `if-else` lồng nhau.

```javascript
// Tính toán trạng thái "On-the-fly" mỗi khi Load sản phẩm
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

- **Middleware Phân Quyền (`auth.mdw.js`):** Gán cứng tên vai trò bằng lệnh `===`.

```javascript
// src/middlewares/auth.mdw.js
export function isSeller(req, res, next) {
  // Mã cứng định danh "seller"
  if (req.session.authUser.role === "seller") {
    next();
  } else {
    res.redirect("/account/login");
  }
}
```

**❖ Đánh giá tác động:** Mỗi khi cần thêm trạng thái mới (Disputed, Return) hay vai trò mới (Moderator), bắt buộc phải mở hàng loạt file này để sửa chuỗi IF-ELSE, rủi ro sinh bug là không thể đếm xuể. Trái ngược hoàn toàn nguyên tắc "Đóng với sự sửa đổi".
**❖ Đề xuất cải thiện:** Thêm trường `status` lưu trực tiếp trong CSDL và sử dụng **State Design Pattern**. Đối với phần quyền, chuyển sang mô hình **RBAC (Role-Based Access Control)** bằng hàm đánh giá linh hoạt.

---

### 3. Liskov Substitution Principle (LSP) - Nguyên lý Thay thế lớp con

**❖ Tìm kiếm các vi phạm:**

- **Logic ẩn sản phẩm đã kết thúc (`product.route.js`):** Ép định danh người dùng phải thuộc 2 loại cố định mới được xem.

```javascript
// src/routes/product.route.js
// Ép kiểu User phải là Seller hoặc Bidder. Chặn đứng các class CS/Admin.
if (!isSeller && !isHighestBidder) {
  return res.status(403).render("403");
}
```

- **Cập nhật Profile (`account.route.js`):** Dùng cấu trúc `if` để né việc kiểm tra mật khẩu đối với tài khoản Facebook/Google (OAuth).

```javascript
// src/routes/account.route.js
// Tài khoản OAuth và Local phân mảnh hành vi ở cấp độ Controller
if (!currentUser.oauth_provider) {
  const isValid = await bcrypt.compare(old_password, currentUser.password_hash);
  if (!isValid) throw new Error("Mật khẩu cũ không đúng");
}
```

**❖ Đánh giá tác động:** Cản trở tính đa hình. Hệ thống không thể mở rộng trơn tru cho Admin xem log ẩn, hoặc mở rộng thêm tính năng cho user bên thứ 3 (Apple/OAuth) mà không phải chắp vá các toán tử điều kiện rẽ nhánh vào Controller.
**❖ Đề xuất cải thiện:** Dùng Abstract Policy, ví dụ: `AuthorizationService.canViewProduct(currentUser, product)`. Uỷ quyền logic check pass cho `IdentityProvider`.

---

### 4. Interface Segregation Principle (ISP) - Nguyên lý Phân tách giao diện

**❖ Tìm kiếm các vi phạm:**

- **"God Model" `product.model.js`:** File dài gần 1000 dòng chứa gần 30 chức năng pha trộn.

```javascript
// src/models/product.model.js
export function findById(id) { ... } // Truy xuất thông thường
export function searchPageByKeywords(...) { ... } // Search Engine (FTS)
export function getSellerStats(sellerId) { ... } // Module Thống Kê Doanh Thu
export function cancelProduct(...) { ... } // Huỷ đơn
```

- **Cấu trúc Router (`product.route.js`):** Import tới 14 model ngoại vi. Tồn tại các endpoint lạ.

```javascript
// src/routes/product.route.js
import * as productModel from "../models/product.model.js";
import * as categoryModel from "../models/category.model.js";
import * as reviewModel from "../models/review.model.js"; // Review đáng lẽ ở Route riêng
import * as biddingHistoryModel from "../models/biddingHistory.model.js";
// Gánh cả chức năng WatchList và Lịch sử Bid
```

**❖ Đánh giá tác động:** Ép Controller phải import khối logic khổng lồ không liên quan ngay cả khi chỉ truy xuất thông tin nhỏ. Gây tốn RAM và sinh ra Merge Conflicts liên tục cho team DEV.
**❖ Đề xuất cải thiện:** Tách Model thành các Repository nhỏ: (`ProductCatalogRepository`, `SellerAnalyticsRepository`). Phân luồng endpoint về đúng Controller tương ứng.

---

### 5. Dependency Inversion Principle (DIP) - Nguyên lý Đảo ngược phụ thuộc

**❖ Tìm kiếm các vi phạm:**

- **Phụ thuộc cứng Database Adapter (`src/models/*.js`) và Thư viện ngoại vi (`src/routes/*.js`):** Import tệp nối DB và Auth Utils khắp nơi.

```javascript
// src/models/product.model.js
// Khóa chặt (Vendor lock-in) với Knex.js và PostgreSQL cụ thể
import db from "../utils/db.js";

// src/routes/account.route.js
import bcrypt from "bcryptjs";
import { sendMail } from "../utils/mailer.js";
```

**❖ Đánh giá tác động:** Các module bậc cao (Controller) phụ thuộc trực tiếp vào module bậc thấp. Tuyệt đối không thể viết Auto Unit Test vì không thể mock (giả lập) DB Adapter hoặc Mailer một cách an toàn. Sẽ cực kỳ khó khăn nếu tương lai công ty đổi sang MongoDB.
**❖ Đề xuất cải thiện:** Áp dụng **Dependency Injection (DI)**: Model nhận `dbAdapter` qua Constructor. Đăng ký các Interface (`IEmailProvider`, `ICryptoService`) qua DI Container.

---

## II. Nguyên lý DRY (Don't Repeat Yourself)

**❖ Tìm kiếm các vi phạm:**

1. **Lặp lại logic tạo OTP (Copy 6 lần ở nhiều tuyến mã):**

```javascript
// Đoạn mã này bị vứt rải rác ở đống Sign-up, Reset Pass, Đổi Pass,...
const otp = Math.floor(100000 + Math.random() * 900000).toString();
const otpValidUntil = new Date(Date.now() + 10 * 60 * 1000);
```

2. **Lặp lại logic SQL tìm kiếm phân trang (`product.model.js`):** Hơn 65 dòng mã `if(category) query.where(...)`, `if(keyword) ...` nối chuỗi truy vấn bị lặp y đúc giữa `searchPageByKeywords()` và `countByKeywords()`.
3. **Template Email phân mảnh:** Hằng tá khối biến chuỗi `` const htmlContent = `<div>...</div>` `` bị gắn cứng trong file xử lý route HTTP.

**❖ Đánh giá tác động:** Thay đổi 1 thông số (VD tăng OTP lên 8 số) sẽ gây ra hiệu ứng domino phải sửa 6 file khác nhau.
**❖ Đề xuất cải thiện:** Xây dựng file `utils/otp.js` gọi `createAndSendOtp()`. Chuẩn hóa Email bằng `emailTemplates.js`. Xây dựng hàm Helper sinh chuỗi SQL dùng chung trong Model.

---

## III. Nguyên lý KISS (Keep It Simple, Stupid)

**❖ Tìm kiếm các vi phạm:**

- **Helper `mask_name` phức tạp hoá logic cơ bản (`src/index.js`):**

```javascript
// Mớ lồng lặp rối rắm để giải quyết 1 tác vụ đơn giản là ẩn tên
mask_name(fullname) {
    if (!fullname) return '';
    const parts = fullname.split(' ');
    // ... Khối lặp for, bắt length == 1, length == 2 phức tạp ...
    if (parts.length === 1) { return '***' + parts[0].slice(-1); }
    return '***' + parts[parts.length - 1];
}

// Lẽ ra chỉ cần 1 dòng:
// return '***' + (fullname.split(' ').pop() || '');
```

**❖ Đánh giá tác động:** Viết code rườm rà làm suy giảm khả năng thấu hiểu mã, sinh bug ngầm ở những biến cố biên (edge cases). Tưởng nhỏ nhưng gom lại làm cho dự án nặng nề.
**❖ Đề xuất cải thiện:** Áp dụng tư duy Functional, khai thác tối đa API mặc định của JS (`split`, `map`, `pop`, Regex).

---

## IV. Nguyên lý YAGNI (You Ain't Gonna Need It)

**❖ Tìm kiếm các vi phạm:**

1. **Over-fetching trong SQL Queries:** Lệnh `SELECT *` hoặc móc nối `JOIN` gọi ra toàn bộ các bảng mặc dù ngoài màn hình Dashboard chỉ cần hiện `name` và `price`.
2. **Over-engineered Timestamp (Trong thiết kế Database):**

```sql
-- Dữ liệu sinh ra để "phòng ngừa tương lai" nhưng code chưa bao giờ đụng đến
updated_at TIMESTAMP,
pending_at TIMESTAMP,  -- Chưa từng dùng
closed_at TIMESTAMP,
cancelled_at TIMESTAMP -- Khá thừa thãi
```

**❖ Đánh giá tác động:** Thiết kế "làm đề phòng dùng đến trong tương lai" tiêu hao bộ nhớ Database, làm phình to Entity payload và giảm hiệu suất truyền tải API.
**❖ Đề xuất cải thiện:** Chuẩn hóa lại các Response (chỉ `SELECT` trường cần thiết). Gom các Timestamp lịch sử thừa bằng một bảng Log chung hoặc dùng duy nhất chuỗi `status` + `updated_at`.

---

_Báo cáo kết thúc._
