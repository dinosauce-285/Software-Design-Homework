# Phân tích vi phạm nguyên lý YAGNI trong dự án Auction Web

Dựa trên quá trình phân tích mã nguồn của dự án Auction Web, nhóm chúng em đã phát hiện các vi phạm về nguyên lý YAGNI (You Aren't Gonna Need It).

---

## Nguyên lý YAGNI (You Aren't Gonna Need It)

**Định nghĩa:** Lập trình viên không nên thêm bất kỳ chức năng, phương thức hay thiết kế nào vào mã nguồn cho đến khi tính năng đó **thực sự cần thiết**. Việc viết code dự phòng cho "tương lai" (Just-in-case coding) hoặc thiết kế ứng dụng quá mức cần thiết (Over-engineering) sẽ làm tăng độ phức tạp, tốn thời gian maintain những đoạn code chết (dead code) không bao giờ chạy tới.

### Vị trí vi phạm số 1: Viết sẵn hàng loạt hàm Query nhưng không bao giờ xài tới (Dead Code)
- **File:** `src/models/systemSetting.model.js`
- **Chức năng:** Module xử lý các cấu hình hệ thống (System Settings) như thời gian auto-extend, giới hạn phút sản phẩm mới, v.v.

### Mã nguồn hiện tại
Trong file model này có tổng cộng 5 hàm được `export`, tuy nhiên qua tìm kiếm toàn bộ mã nguồn của Project, ứng dụng **chỉ gọi duy nhất hàm `getSettings()`**, 4 hàm rưỡi còn lại bị bỏ hoang hoàn toàn.

```javascript
// src/models/systemSetting.model.js
import db from '../utils/db.js';

export function getAllSettings() {                  // KHÔNG TỒN TẠI NƠI GỌI
    return db('system_settings').select('*');
}

export function getSettings() {                     // ĐƯỢC CHỖ DUY NHẤT LÀ ROUTE SỬ DỤNG
    return db('system_settings').first();
}

export function getSetting(key) {                   // KHÔNG TỒN TẠI NƠI GỌI
    return db('system_settings')
        .where({ key })
        .first();
}

export function updateSetting(key, value) {         // KHÔNG TỒN TẠI NƠI GỌI
    return db('system_settings')
        .update({ value })
        .where({ key });
}

export function editNewProductLimitMinutes(minutes) { // KHÔNG TỒN TẠI NƠI GỌI
    return db('system_settings')
        .update({ value: minutes })
        .where({ key: 'new_product_limit_minutes' });
}
```

### Nguyên nhân và Đánh giá tác động
Lập trình viên khi tạo Entity `SystemSetting` đã theo thói quen tạo đủ một bộ CRUD (Create, Read, Update, Delete/Edit) vì "nghĩ rằng" sau này trang Admin kiểu gì cũng cần đổi Settings. Nhưng thực tế trong Route Admin không hề có code xử lý đổi cấu hình. Mọi cấu hình đều được tạo sẵn ở file `.sql` khi khởi tạo DB.
- **Tác động bảo trì:** 
  1. Vi phạm nghiêm trọng nguyên lý YAGNI. Đoạn dead-code này phải được unit test bao phủ (nếu công ty có yêu cầu coverage), làm tăng thời gian viết test vô nghĩa.
  2. Bất cứ ai vào file `systemSetting.model.js` sẽ lầm tưởng hệ thống có tính năng cho phép tùy chỉnh Setting cụ thể qua `editNewProductLimitMinutes` và gây hiểu lầm thiết kế.
  3. Làm phình to dung lượng mã nguồn và bộ nhớ đệm.

### Giải pháp cải thiện
Xóa ngay lập tức mọi đoạn code chết! Chỉ giữ lại duy nhất hàm ứng dụng hiện đang cần.

**Cách khắc phục:**
```javascript
import db from '../utils/db.js';

export function getSettings() {
    return db('system_settings').first();
}
// Xóa toàn bộ getAllSettings, getSetting, updateSetting, editNewProductLimitMinutes!
// Khi nào ứng dụng THỰC SỰ có giao diện Admin đòi đổi Setting thì mới code thêm.
```

---

### Vị trí vi phạm số 2: Viết sẵn trọn bộ CRUD "phòng hờ" cho Order và Invoice Model
- **File:** `src/models/order.model.js` và `src/models/invoice.model.js`
- **Chức năng:** Quản lý đơn hàng (Order) và hóa đơn (Invoice) sau khi đấu giá kết thúc.

### Mã nguồn hiện tại
Hai file Model này export ra tổng cộng **hơn 20 hàm**, nhưng qua quá trình tìm kiếm trong toàn bộ Routes của ứng dụng, phần lớn trong số đó **chưa từng được gọi bất kỳ đâu**.

**`order.model.js` (319 dòng, 11 hàm export):**

| Hàm               | Được sử dụng? | Ghi chú                    |
|--------------------|:-------------:|----------------------------|
| `createOrder`      | ✅ Có        | `product.route.js`         |
| `findById`         | ✅ Có        | `product.route.js`         |
| `findByProductId`  | ✅ Có        | `product.route.js`         |
| `updateShippingInfo`| ✅ Có       | `product.route.js`         |
| `updateStatus`     | ✅ Có        | `product.route.js`         |
| `findByIdWithDetails` | ❌ **Không** | Dead code              |
| `findByProductIdWithDetails` | ❌ **Không** | Dead code       |
| `findBySellerId`   | ❌ **Không** | Dead code                  |
| `findByBuyerId`    | ❌ **Không** | Dead code                  |
| `updateTracking`   | ❌ **Không** | Dead code                  |
| `cancelOrder`      | ❌ **Không** | Dead code                  |
| `canUserAccessOrder`| ❌ **Không** | Dead code                 |
| `getStatusHistory` | ❌ **Không** | Dead code                  |
| `countByStatus`    | ❌ **Không** | Dead code                  |

**=> 9/14 hàm là Dead Code (~64%)**

**`invoice.model.js` (269 dòng, 12 hàm export):**

| Hàm                     | Được sử dụng? | Ghi chú                |
|--------------------------|:-------------:|------------------------|
| `createPaymentInvoice`   | ✅ Có        | `product.route.js`     |
| `createShippingInvoice`  | ✅ Có        | `product.route.js`     |
| `getPaymentInvoice`      | ✅ Có        | `product.route.js`     |
| `getShippingInvoice`     | ✅ Có        | `product.route.js`     |
| `verifyInvoice`          | ✅ Có        | `product.route.js`     |
| `findById`               | ❌ **Không** | Dead code              |
| `findByOrderId`          | ❌ **Không** | Dead code              |
| `updateInvoice`          | ❌ **Không** | Dead code              |
| `deleteInvoice`          | ❌ **Không** | Dead code              |
| `hasPaymentInvoice`      | ❌ **Không** | Dead code              |
| `hasShippingInvoice`     | ❌ **Không** | Dead code              |
| `getUnverifiedInvoices`  | ❌ **Không** | Dead code              |

**=> 7/12 hàm là Dead Code (~58%)**

### Nguyên nhân và Đánh giá tác động
Lập trình viên khi tạo mỗi Entity (Order, Invoice) đã theo bản năng tạo trước một bộ CRUD đầy đủ (findById, findByX, update, delete, count...) với suy nghĩ "trước sau gì cũng xài". Đây chính xác là tư duy "Just-In-Case" mà YAGNI cảnh báo.

- **Tác động bảo trì:**
  1. **Tổng cộng 16 hàm (> 200 dòng code) không bao giờ chạy** nhưng vẫn tồn tại trong codebase, tốn thời gian đọc hiểu và đánh lừa người maintain.
  2. Hàm `findByIdWithDetails` và `findByProductIdWithDetails` có các câu truy vấn JOIN phức tạp (4 bảng), nhưng chưa bao giờ được gọi. Nếu DB Schema thay đổi, lập trình viên vẫn phải tốn công sửa các hàm này cho đồng bộ mặc dù chúng **không dùng**.
  3. Hàm `cancelOrder` chỉ là wrapper gọi lại `updateStatus` — thêm một lớp trừu tượng hoàn toàn thừa.

### Giải pháp cải thiện
Xóa tất cả các hàm Dead Code. Chỉ giữ lại các hàm đang thực sự được import và gọi trong Routes.

```diff
// order.model.js - Chỉ giữ lại 5 hàm đang dùng:
  export async function createOrder(orderData) { ... }
  export async function findById(orderId) { ... }
  export async function findByProductId(productId) { ... }
  export async function updateShippingInfo(orderId, shippingData) { ... }
  export async function updateStatus(orderId, newStatus, userId, note) { ... }
- export async function findByIdWithDetails(orderId) { ... }         // XÓA
- export async function findByProductIdWithDetails(productId) { ... } // XÓA
- export async function findBySellerId(sellerId) { ... }             // XÓA
- export async function findByBuyerId(buyerId) { ... }               // XÓA
- export async function updateTracking(orderId, trackingData) { ... } // XÓA
- export async function cancelOrder(orderId, userId, reason) { ... }  // XÓA
- export async function canUserAccessOrder(orderId, userId) { ... }   // XÓA
- export async function getStatusHistory(orderId) { ... }             // XÓA
- export async function countByStatus(userId, userType) { ... }       // XÓA
```

---

### Vị trí vi phạm số 3: Import thư viện và viết code cho tính năng bị vô hiệu hóa (Twitter OAuth)
- **File:** `src/utils/passport.js` và `package.json`
- **Chức năng:** Đăng nhập bằng mạng xã hội (OAuth) qua Twitter.

### Mã nguồn hiện tại
Trong file `passport.js`, lập trình viên đã:
1. **Import** thư viện `passport-twitter` ở đầu file (dòng 4).
2. **Viết trọn** bộ Strategy xử lý đăng nhập Twitter (~40 dòng, dòng 112-150).
3. Sau đó lại **comment toàn bộ Strategy** vì "Twitter API requires paid subscription ($100/month)".
4. Thư viện `passport-twitter` vẫn nằm trong `package.json` (dòng 18) và được cài vào `node_modules`.

```javascript
// src/utils/passport.js (Dòng 1-4)
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { Strategy as TwitterStrategy } from 'passport-twitter';  // ⚠️ IMPORT NHƯNG KHÔNG BAO GIỜ DÙNG
import { Strategy as GitHubStrategy } from 'passport-github2';

// ... (Dòng 109-150)
// ===================== TWITTER STRATEGY =====================
// DISABLED: Twitter API requires paid subscription ($100/month) for OAuth
// Free tier does not support OAuth since February 2023
/*
passport.use(new TwitterStrategy({
  consumerKey: process.env.TWITTER_CONSUMER_KEY,
  // ... ~40 dòng code bị comment ...
}));
*/
```

### Nguyên nhân và Đánh giá tác động
Lập trình viên viết sẵn tính năng đăng nhập Twitter vì "nghĩ rằng" sau này sẽ dùng, nhưng phát hiện API phải trả phí nên comment lại. Thay vì xóa sạch sẽ, họ để nguyên vì "biết đâu sau này Twitter miễn phí lại".

- **Tác động bảo trì:**
  1. Thư viện `passport-twitter` vẫn được tải về, chiếm dung lượng `node_modules` và **tăng attack surface** (lỗ hổng bảo mật tiềm ẩn từ dependency bên thứ 3 không dùng).
  2. Đoạn code comment 40+ dòng làm nhiễu file `passport.js`, khiến người maintain phải đọc qua và tự hỏi "cái này hoạt động không?".
  3. Biến `TwitterStrategy` được import nhưng không dùng, gây cảnh báo lint (unused import) và lãng phí bộ nhớ khi ứng dụng khởi chạy.

### Giải pháp cải thiện
Xóa sạch: import, strategy, và dependency khỏi `package.json`.

```diff
// passport.js
  import passport from 'passport';
  import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
  import { Strategy as FacebookStrategy } from 'passport-facebook';
- import { Strategy as TwitterStrategy } from 'passport-twitter'; // XÓA
  import { Strategy as GitHubStrategy } from 'passport-github2';

- // ===================== TWITTER STRATEGY =====================
- // DISABLED: ... (Xóa toàn bộ block comment ~40 dòng)
```

```diff
// package.json
  "passport-github2": "^0.1.12",
  "passport-google-oauth20": "^2.0.0",
- "passport-twitter": "^1.0.4",              // XÓA khỏi dependencies
  "pg": "^8.16.3",
```
Sau đó chạy `npm install` để cập nhật lockfile và giải phóng `node_modules`.

---

### Vị trí vi phạm số 4: Hàm truy vấn phân trang cũ không ai dùng trong `product.model.js`
- **File:** `src/models/product.model.js`
- **Chức năng:** Hàm `findPage(limit, offset)` — lấy danh sách sản phẩm theo phân trang.

### Mã nguồn hiện tại
```javascript
// src/models/product.model.js (Dòng 75-90)
export function findPage(limit, offset) {
  return db('products')
    .leftJoin('users', 'products.highest_bidder_id', 'users.id')
    .select(
      'products.*', 
      db.raw(`mask_name_alternating(users.fullname) AS bidder_name`),
      db.raw(`
        (
          SELECT COUNT(*) 
          FROM bidding_history 
          WHERE bidding_history.product_id = products.id
        ) AS bid_count
      `)
    ).limit(limit).offset(offset);
}
```

Qua quá trình tìm kiếm toàn bộ codebase (`grep "productModel.findPage"`), **không có bất kỳ chỗ nào gọi hàm này**. Ứng dụng sử dụng các hàm phân trang khác như `searchPageByKeywords`, `searchPageByCategoryIds` thay thế.

### Nguyên nhân và Đánh giá tác động
Đây là hàm được viết trong giai đoạn đầu phát triển, khi trang chủ hiển thị sản phẩm đơn giản. Sau đó ứng dụng chuyển sang dùng hàm tìm kiếm và lọc theo danh mục nâng cao hơn, nhưng `findPage` không được xóa đi.

- **Tác động bảo trì:**
  1. Hàm chứa subquery `bid_count` giống như nhiều hàm khác. Nếu cấu trúc bảng `bidding_history` thay đổi, lập trình viên phải đi sửa thêm cả hàm chết này.
  2. Gây nhầm lẫn cho người mới: Không biết `findPage` hay `searchPageByKeywords` mới là hàm "chính" để lấy danh sách sản phẩm.

### Giải pháp cải thiện
Xóa hàm `findPage` khỏi `product.model.js`. Ngoài ra, cũng nên kiểm tra lại biến `BASE_QUERY` (dòng 334-342) vì biến hằng này tạo sẵn một câu truy vấn "Top 5" dùng chung cho `findTopEnding` và `findTopPrice`, nhưng hàm `findTopBids` lại **không dùng** `BASE_QUERY` mà viết lại câu query từ đầu — dấu hiệu cho thấy `BASE_QUERY` đã không còn phù hợp và cần được đánh giá lại.

```diff
// product.model.js
- export function findPage(limit, offset) {   // XÓA TOÀN BỘ HÀM NÀY
-   return db('products')
-     .leftJoin('users', 'products.highest_bidder_id', 'users.id')
-     .select(
-       'products.*', 
-       db.raw(`mask_name_alternating(users.fullname) AS bidder_name`),
-       db.raw(`...`)
-     ).limit(limit).offset(offset);
- }
```
