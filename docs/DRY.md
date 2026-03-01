# Phân tích vi phạm nguyên lý DRY trong dự án Auction Web

Dựa trên quá trình phân tích mã nguồn của dự án Auction Web, nhóm chúng em đã phát hiện các vi phạm về nguyên lý DRY (Don't Repeat Yourself). 

---

## Nguyên lý DRY (Don't Repeat Yourself)

**Định nghĩa:** Mỗi phần cứng logic, tri thức hoặc đoạn mã nguồn trong hệ thống chỉ nên có một điểm định nghĩa (Single Source of Truth) duy nhất, rõ ràng và không bị lặp lại. Việc vi phạm DRY (còn gọi là WET - Write Everything Twice) dẫn đến khó khăn trong bảo trì: khi cần thay đổi một logic, lập trình viên phải đi tìm và sửa ở hàng loạt nơi khác nhau, rất dễ gây ra sót lỗi (bug sọt rác).

### Vị trí vi phạm
- **File:** `src/models/product.catalog.model.js`
- **Chức năng:** Logic truy vấn số lượng lượt đấu giá (`bid_count`) và ẩn danh tên người đấu giá (`bidder_name`) bằng Raw SQL được lặp lại sao chép nguyên trạng ở rất nhiều hàm truy vấn khác nhau.

### Mã nguồn hiện tại
Đoạn mã Raw SQL sau đây được copy-paste y hệt trong ít nhất **10 hàm khác nhau** (`findAll`, `findByProductIdForAdmin`, `findPage`, `searchPageByKeywords`, `findByCategoryId`, `findByCategoryIds`, `findRelatedProducts`, `findByProductId2`, v.v.):

```javascript
// Vi phạm số 1: Lặp lại truy vấn đếm số lượt bid (bid_count)
db.raw(`
  (
    SELECT COUNT(*) 
    FROM bidding_history 
    WHERE bidding_history.product_id = products.id
  ) AS bid_count
`)

// Vi phạm số 2: Lặp lại truy vấn ẩn danh người dùng đánh giá cao nhất (bidder_name)
db.raw(`mask_name_alternating(users.fullname) AS bidder_name`)
```

*Ví dụ trong hàm `searchPageByKeywords` (Dòng 137-144):*
```javascript
    .select(
      'products.*',
      'categories.name as category_name',
      db.raw(`mask_name_alternating(users.fullname) AS bidder_name`), // LẶP LẠI
      db.raw(`
        ( 
          SELECT COUNT(*)
          FROM bidding_history
          WHERE bidding_history.product_id = products.id
        ) AS bid_count
      `), // LẶP LẠI
      db.raw('watchlists.product_id IS NOT NULL AS is_favorite')
    );
```

*Tiếp tục xuất hiện y hệt trong hàm `findByCategoryId` (Dòng 235-244):*
```javascript
    .select(
      'products.*',
      
      // Logic che tên người đấu giá (giữ nguyên)
      db.raw(`mask_name_alternating(users.fullname) AS bidder_name`), // LẶP LẠI

      // Logic đếm số lượt đấu giá (giữ nguyên)
      db.raw(`
        (
          SELECT COUNT(*) 
          FROM bidding_history 
          WHERE bidding_history.product_id = products.id
        ) AS bid_count
      `), // LẶP LẠI
```

### Nguyên nhân và Đánh giá tác động
Lập trình viên khi viết các hàm query báo cáo, tìm kiếm hoặc phân trang mới đã chọn cách bôi đen copy khối `.select(...)` từ các hàm cũ sang hàm mới thay vì tách phần logic tạo truy vấn (Query Builder) thành một hàm phụ trợ tái sử dụng.
- **Tác động bảo trì:** 
  1. Giả sử sau này bảng `bidding_history` đổi tên thành `auction_bids`, lập trình viên sẽ phải thực hiện "Find & Replace" `bidding_history` ở gần 15 chỗ khác nhau trong `product.catalog.model.js`.
  2. Nếu logic ẩn tên đổi từ `mask_name_alternating(users.fullname)` sang một logic bảo mật cao hơn như `mask_name_v2(users.email, users.fullname)`, chúng ta lại phải đi sửa thủ công ở mọi truy vấn `select`. Việc bỏ sót 1-2 hàm sẽ khiến UI hiển thị không đồng nhất trên các trang khác nhau.

### Giải pháp cải thiện
Sử dụng các hằng số (constants) hoặc hàm phụ trợ (helper functions) sinh ra mảng query truyền vào `.select()` để tái sử dụng toàn cục trong file module đó.

**Cách 1: Extract Query Logic thành hằng số / mảng Selectors tái sử dụng**

```javascript
// Ở đầu file src/models/product.catalog.model.js
const BID_COUNT_QUERY = db.raw(`
  (
    SELECT COUNT(*) 
    FROM bidding_history 
    WHERE bidding_history.product_id = products.id
  ) AS bid_count
`);

const MASK_BIDDER_NAME_QUERY = db.raw(`mask_name_alternating(users.fullname) AS bidder_name`);

// Gom nhóm các field thường được lấy cùng nhau cho Product Summary
const PRODUCT_SUMMARY_SELECTORS = [
  'products.*',
  MASK_BIDDER_NAME_QUERY,
  BID_COUNT_QUERY
];

// Sau đó ở tất cả các hàm, ta chỉ cần gọi:
export function findPage(limit, offset) {
  return db('products')
    .leftJoin('users', 'products.highest_bidder_id', 'users.id')
    .select(...PRODUCT_SUMMARY_SELECTORS)
    .limit(limit).offset(offset);
}

export function searchPageByKeywords(...) {
  let query = db('products')
    // ... các lệnh join, where
    .select(
      ...PRODUCT_SUMMARY_SELECTORS,
      'categories.name as category_name',
      db.raw('watchlists.product_id IS NOT NULL AS is_favorite')
    );
  // ...
}
```

Với giải pháp này, khi cần đổi bảng lịch sử đấu giá hoặc hàm đổi tên Ẩn danh, ta chỉ cần sửa đúng ở một chỗ duy nhất (phần khai báo hằng số).

---

### Vị trí vi phạm số 2
- **File:** `src/routes/account.route.js`
- **Chức năng:** Logic tạo mã OTP, lưu trữ OTP vào cơ sở dữ liệu và gửi email thông báo mã OTP.

### Mã nguồn hiện tại
Đoạn mã xử lý quy trình sinh OTP và gửi email bị lặp lại gần như y hệt ở **4 route khác nhau** (Quên mật khẩu, Gửi lại mã quên mật khẩu, Đăng ký, Đăng nhập khi chưa xác thực email, Gửi lại mã xác thực):

*Ví dụ ở Route `POST /forgot-password` (Dòng 83-98):*
```javascript
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 phút
  await userModel.createOtp({
    user_id: user.id,
    otp_code: otp,
    purpose: 'reset_password', // Chỉ khác nhau duy nhất chữ này
    expires_at: expiresAt,
  });
  await sendMail({
    to: email,
    subject: 'Password Reset for Your Online Auction Account', // Khác subject
    html: `
      <p>Hi ${user.fullname},</p>
      <p>Your OTP code for password reset is: <strong>${otp}</strong></p>
      <p>This code will expire in 15 minutes.</p>
    `,
  });
```

*Đoạn mã trên lại xuất hiện y hệt ở `POST /signin` (Dòng 197-215):*
```javascript
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 phút

    await userModel.createOtp({
      user_id: user.id,
      otp_code: otp,
      purpose: 'verify_email', // Khác nhau purpose
      expires_at: expiresAt,
    });

    await sendMail({
      to: email,
      subject: 'Verify your Online Auction account',
      html: `
        <p>Hi ${user.fullname},</p>
        <p>Your OTP code is: <strong>${otp}</strong></p>
        <p>This code will expire in 15 minutes.</p>
      `,
    });
```
Và lại xuất hiện tiếp ở các route `POST /resend-otp`, `POST /signup`, `POST /resend-forgot-password-otp`.

### Nguyên nhân và Đánh giá tác động
Nguyên nhân là do việc gửi email và tạo OTP thường đi liền với nhau thành một luồng (flow) nghiệp vụ, nhưng lập trình viên cài đặt xử lý phân tán rải rác ở từng endpoint thay vì gom nhóm thành một Service thống nhất.
- **Tác động bảo trì:** 
  1. Nếu ứng dụng muốn thay đổi thời hạn sống của mã OTP từ 15 phút xuống 5 phút cho bảo mật cao hơn, lập trình viên sẽ phải nhớ và đi sửa ở 5 chỗ khác nhau. Chỉ cần sót một chỗ, ứng dụng sẽ có lỗ hổng (inconsistency).
  2. Rất khó để thay đổi dịch vụ gửi email hoặc cấu trúc nội dung email OTP HTML (ví dụ muốn thêm logo thương hiệu vào khung email gửi đi) vì nó bị "hard-code" rải rác khắp nơi.

### Giải pháp cải thiện
Gói gọn toàn bộ nghiệp vụ (Sinh mã + Lưu DB + Gửi email) vào một hàm Helper/Service cục bộ.

**Cách 1: Tạo Function `processOtpAndSendEmail` tái sử dụng**

```javascript
// Khai báo một lần ở file helper hoặc trên đầu file route
import { sendMail } from '../utils/mailer.js';

async function generateAndSendOtp(user, purpose, subject, emailTemplateText) {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 phút (Định nghĩa DUY NHẤT ở đây)

  await userModel.createOtp({
    user_id: user.id,
    otp_code: otp,
    purpose: purpose,
    expires_at: expiresAt,
  });

  await sendMail({
    to: user.email,
    subject: subject,
    html: `
      <p>Hi ${user.fullname},</p>
      ${emailTemplateText.replace('{{otp}}', otp)}
      <p>This code will expire in 15 minutes.</p>
    `,
  });
}

// Khi đó, route POST /forgot-password chỉ cần gọi:
router.post('/forgot-password', async (req, res) => {
  // ... check user valid
  await generateAndSendOtp(
    user, 
    'reset_password', 
    'Password Reset', 
    '<p>Your OTP code for password reset is: <strong>{{otp}}</strong></p>'
  );
  return res.render('vwAccount/auth/verify-forgot-password-otp', { email });
});

// Còn POST /signin chỉ việc:
router.post('/signin', async (req, res) => {
  // ... check email, pass
  if (!user.email_verified) {
    await generateAndSendOtp(
      user, 
      'verify_email', 
      'Verify your account', 
      '<p>Your OTP code is: <strong>{{otp}}</strong></p>'
    );
    return res.redirect(...);
  }
});
```
Với thiết kế này, logic tạo OTP và cấu trúc Email HTML được quản lý tập trung ở một nơi duy nhất.

---

### Vị trí vi phạm số 3
- **File:** `src/routes/product.route.js` và `src/routes/account.route.js`
- **Chức năng:** Logic tính toán phân trang (Pagination) bao gồm tính offset, số trang, điểm bắt đầu và điểm kết thúc của danh sách.

### Mã nguồn hiện tại
Đoạn mã xử lý toán học cho phân trang và giới hạn hiển thị bị sao chép lặp lại ở gần như mọi endpoint có danh sách (như `/category`, `/search`, `/watchlist`...):

*Ví dụ ở Route `GET /category` (Dòng 66-71):*
```javascript
  const totalCount = parseInt(total.count) || 0;
  const nPages = Math.ceil(totalCount / limit);
  let from = (page - 1) * limit + 1;
  let to = page * limit;
  if (to > totalCount) to = totalCount;
  if (totalCount === 0) { from = 0; to = 0; }
```

*Đoạn mã trên xuất hiện y hệt ở Route `GET /search` (Dòng 118-124):*
```javascript
  const totalCount = parseInt(total.count) || 0;
  
  const nPages = Math.ceil(totalCount / limit);
  let from = (page - 1) * limit + 1;
  let to = page * limit;
  if (to > totalCount) to = totalCount;
  if (totalCount === 0) { from = 0; to = 0; }
```
*Và ở Route `GET /watchlist` bên `account.route.js` (Dòng 546-551)*.

### Nguyên nhân và Đánh giá tác động
Lập trình viên viết lại các công thức toán học cơ bản (`skip`, `take`, `from`, `to`) ở mọi nơi cần phân trang.
- **Tác động bảo trì:** 
  1. Nếu ứng dụng thay đổi cách hiển thị phân trang (ví dụ không dùng `from`, `to` nữa mà dùng logic Cursor-based pagination để tăng performance), lập trình viên sẽ phải sửa tay hàng chục controller khác nhau.
  2. Code ở Router bị phình to (bloated) bởi các phép tính toán học không mang tính chất điều hướng (routing) hay kiểm soát (controlling) request HTTP. Điều này vi phạm cả Single Responsibility.

### Giải pháp cải thiện
Tách phần tính toán phân trang thành một Utility Function.

**Cách 1: Tạo `paginationHelper.js` trong thư mục utils**

```javascript
// src/utils/paginationHelper.js
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
    currentPage: page
  };
}

// Sử dụng tại Controller (VD: GET /search):
import { calculatePagination } from '../utils/paginationHelper.js';

router.get('/search', async (req, res) => {
  // ...
  const page = parseInt(req.query.page) || 1;
  const limit = 3;
  
  const list = await productModel.searchPageByKeywords(...);
  const total = await productModel.countByKeywords(...);
  
  const paginationData = calculatePagination(total.count, page, limit);
  
  res.render('vwProduct/list', { 
    products: list,
    ...paginationData, // Rải object trả về vào thẳng context truyền cho view
    q: keywords
  });
});
```
Với thiết kế này, logic phân trang được trừu tượng hóa (abstracted) hoàn toàn khỏi Controller, giúp code sạch và chuẩn DRY.
