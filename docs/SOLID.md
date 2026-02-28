# Phân tích vi phạm nguyên lý SOLID trong dự án Auction Web

Dựa trên quá trình tìm hiểu và phân tích mã nguồn (chủ yếu trong thư mục `src`), nhóm chúng em đã phát hiện các vi phạm về nguyên lý **Liskov Substitution Principle (LSP)** và **Interface Segregation Principle (ISP)**. Vì ngữ cảnh của ứng dụng sử dụng Express.js (Node.js) mang thiên hướng lập trình chức năng (Functional/Procedural) hơn là Hướng đối tượng (OOP) truyền thống với class, các vi phạm sau sẽ được mô tả dưới dạng tương đương về cấu trúc và tư duy thiết kế hệ thống.

---

## 1. Liskov Substitution Principle (LSP) - Nguyên lý thay thế Liskov

**Định nghĩa:** Các đối tượng của lớp con phải có thể thay thế hoàn toàn cho các đối tượng của lớp cha mà không làm thay đổi tính đúng đắn của chương trình. Trong lập trình động (như JavaScript) không có class/interface minh bạch, điều này có nghĩa là khi một hàm nhận các thực thể "cùng kiểu" (ví dụ `User` - bao gồm `LocalUser` và `OAuthUser`), nó không nên chứa logic kiểu `if (kiểu_của_user === 'something')` để kiểm tra phân luồng riêng.

### Vị trí vi phạm (đã sửa)
- **File:** `src/routes/account.route.js`
- **Chức năng:** Xử lý cập nhật thông tin người dùng (Router `PUT /profile`).

### Mã nguồn cũ (vi phạm LSP)
```javascript
// PUT /profile - XỬ LÝ UPDATE (cũ — vi phạm LSP)
router.put('/profile', isAuthenticated, async (req, res) => {
  const currentUser = await userModel.findById(currentUserId);

  // Kiểm tra trực tiếp loại user trong router → VI PHẠM LSP
  if (!currentUser.oauth_provider) {
    if (!old_password || !bcrypt.compareSync(old_password, currentUser.password_hash)) {
      return res.render('vwAccount/profile', { err_message: 'Password is incorrect!' });
    }
  }

  if (!currentUser.oauth_provider && new_password) {
    if (new_password !== confirm_new_password) { ... }
  }

  const entity = { ... };
  if (!currentUser.oauth_provider) {
    entity.password_hash = new_password
      ? bcrypt.hashSync(new_password, 10)
      : currentUser.password_hash;
  }

  await userModel.update(currentUserId, entity);
});
```

### Nguyên nhân và Đánh giá tác động
Nguyên lý LSP quy định client (hàm update profile) có thể thao tác với đối tượng `User` một cách đồng nhất. Tuy nhiên, ở đây ta thấy rõ sự chia cắt: Một loại User đăng nhập bằng Local Auth (có `password_hash`) và một loại bằng OAuth (có `oauth_provider`).

Việc router phải liên tục kiểm tra `!currentUser.oauth_provider` để phục vụ cho sự thiếu sót về mặt đa hình (polymorphism) cho thấy `OAuthUser` **không thể thay thế** hoàn toàn vai trò của một `LocalUser` trong phương thức cập nhật này.
- **Tác động bảo trì:** Khi có một loại hình đăng nhập mới (ví dụ: Enterprise SSO SAML) không sử dụng `password_hash` lẫn `oauth_provider` hiện tại, lập trình viên sẽ phải sửa đổi lại tất cả các router này. Code bị rẽ nhánh phức tạp, khó viết Unit Test và dễ gặp lỗi logic.

### Giải pháp đã áp dụng: Strategy Pattern
Áp dụng tính **Đa hình (Polymorphism)** thông qua **Strategy Pattern**. Logic kiểm tra và chuẩn bị dữ liệu được đóng gói vào lớp Service/Strategy, tránh hoàn toàn việc kiểm tra `oauth_provider` ở phía Router.

**File tạo mới:** `src/utils/identity.provider.js`
```javascript
// src/utils/identity.provider.js

/** Base Strategy — định nghĩa giao diện chung */
export class IdentityProvider {
  validateProfileUpdate(user, payload) {
    throw new Error("Method not implemented.");
  }
  prepareUpdateEntity(user, payload) {
    throw new Error("Method not implemented.");
  }
}

/** Strategy cho tài khoản Local (đăng ký thông thường) */
export class LocalIdentityProvider extends IdentityProvider {
  validateProfileUpdate(user, payload) {
    const { old_password, new_password, confirm_new_password } = payload;
    if (!old_password || !bcrypt.compareSync(old_password, user.password_hash)) {
      throw new Error("Password is incorrect!");
    }
    if (new_password && new_password !== confirm_new_password) {
      throw new Error("New passwords do not match.");
    }
  }

  prepareUpdateEntity(user, payload) {
    const { email, fullname, address, date_of_birth, new_password } = payload;
    return {
      email, fullname,
      address: address || user.address,
      date_of_birth: date_of_birth ? new Date(date_of_birth) : user.date_of_birth,
      password_hash: new_password ? bcrypt.hashSync(new_password, 10) : user.password_hash,
    };
  }
}

/** Strategy cho tài khoản OAuth (Google, Facebook, GitHub...) */
export class OAuthIdentityProvider extends IdentityProvider {
  validateProfileUpdate(user, payload) {
    // OAuth users bỏ qua validate mật khẩu hoàn toàn
    return true;
  }

  prepareUpdateEntity(user, payload) {
    const { email, fullname, address, date_of_birth } = payload;
    return {
      email, fullname,
      address: address || user.address,
      date_of_birth: date_of_birth ? new Date(date_of_birth) : user.date_of_birth,
      // Không cập nhật password_hash cho OAuth users
    };
  }
}

/** Factory chọn Strategy phù hợp, tách biệt khỏi Router */
export class IdentityProviderFactory {
  static getProvider(user) {
    if (user.oauth_provider) return new OAuthIdentityProvider();
    return new LocalIdentityProvider();
  }
}
```

**Router sau khi sửa** (`src/routes/account.route.js` — PUT /profile):
```javascript
// PUT /profile — Không còn if/else kiểm tra oauth_provider trong Router
router.put('/profile', isAuthenticated, async (req, res) => {
  try {
    const currentUser = await userModel.findById(req.session.authUser.id);

    // Giao cho Strategy đúng loại xử lý — tuân thủ LSP
    const identityProvider = IdentityProviderFactory.getProvider(currentUser);
    try {
      identityProvider.validateProfileUpdate(currentUser, req.body);
    } catch (validationErr) {
      return res.render('vwAccount/profile', { user: currentUser, err_message: validationErr.message });
    }

    const entity = identityProvider.prepareUpdateEntity(currentUser, req.body);
    const updatedUser = await userModel.update(currentUser.id, entity);

    req.session.authUser = updatedUser;
    return res.redirect('/account/profile?success=true');
  } catch (err) {
    return res.render('vwAccount/profile', { err_message: 'System error. Please try again later.' });
  }
});
```

**Kết quả:** Khi thêm loại đăng nhập mới (ví dụ: `SSOIdentityProvider`), chỉ cần tạo class con mới và cập nhật Factory — không cần sửa Router.

---

## 2. Interface Segregation Principle (ISP) - Nguyên lý phân tách Interface

**Định nghĩa:** Khách hàng không nên bị ép buộc phải phụ thuộc vào các interface (phương thức/module) mà họ không sử dụng. Trong hệ sinh thái Module (CommonJS/ES Modules), việc export ra hàng tá hàm tạo thành một giao diện "God Object / Fat Interface" khổng lồ là một sự vi phạm nghiêm trọng của ISP.

### Vị trí vi phạm (đã sửa)
- **File vi phạm gốc:** `src/models/product.model.js` (gần 1000 dòng code, 20+ phương thức)
- **Các client bị ảnh hưởng:** `src/routes/home.route.js`, `src/routes/seller.route.js`, và các route khác

### Mã nguồn cũ (vi phạm ISP)
```javascript
// src/models/product.model.js — Fat Interface (cũ)
export function findAll() { ... }
export function findPage(limit, offset) { ... }
export function findTopEnding() { ... }          // chỉ dùng cho home
export function findTopBids() { ... }            // chỉ dùng cho home
export function findTopPrice() { ... }           // chỉ dùng cho home
export function searchPageByKeywords(...) { ... }
export function countProductsBySellerId(..){ ... } // chỉ dùng cho seller
export async function getSellerStats(sellerId){ ... }// chỉ dùng cho seller
export async function cancelProduct(...) { ... }
// ... 20+ hàm khác hỗn độn trong cùng một file
```

```javascript
// src/routes/home.route.js — Phải kéo cả module khổng lồ (cũ)
import * as productModel from '../models/product.model.js'; // ÉP CLIENT PHỤ THUỘC VÀO CẢ MODULE LỚN

router.get('/', async (req, res) => {
  const [topEnding, topBids, topPrice] = await Promise.all([
    productModel.findTopEnding(),   // CHỈ CẦN 3 HÀM NÀY
    productModel.findTopBids(),
    productModel.findTopPrice(),
  ]);
});
```

### Nguyên nhân và Đánh giá tác động
File `product.model.js` gốc chứa quá nhiều trọng trách: dành cho admin, seller thống kê báo cáo, truy vấn phân trang, tìm kiếm FTS... Khi `home.route.js` cần render trang chủ, nó buộc phải import toàn bộ module chứa hàng chục hàm không dùng đến (`getSellerStats`, `addProductImages`...).
- **Tác động bảo trì:** Một thay đổi nhỏ ở logic thống kê của Seller có thể làm break logic trang chủ — dù trang chủ chẳng liên quan gì. Gây Merge Conflict liên tục khi nhiều developer cùng làm việc.

### Giải pháp đã áp dụng: Feature-based Module Segregation

Tách "Fat Interface" (`product.model.js`) thành nhiều module nhỏ theo chức năng:

| File mới | Trách nhiệm | Loại |
|---|---|---|
| `product.model.js` | Ghi dữ liệu: thêm, sửa, xóa, hủy, cập nhật trạng thái, thông báo | Write (Commands) |
| `product.catalog.model.js` | Truy vấn hiển thị: findAll, findPage, tìm kiếm, trang chủ, chi tiết | Read (Queries) |
| `seller.analytics.model.js` | Thống kê và danh sách sản phẩm theo seller | Seller Analytics |

**`src/routes/home.route.js` sau khi sửa:**
```javascript
// Chỉ import interface cần thiết — đúng ISP
import * as productCatalogModel from '../models/product.catalog.model.js';

router.get('/', async (req, res) => {
  const [topEnding, topBids, topPrice] = await Promise.all([
    productCatalogModel.findTopEnding(),
    productCatalogModel.findTopBids(),
    productCatalogModel.findTopPrice(),
  ]);
  res.render('home', { topEndingProducts: topEnding, topBidsProducts: topBids, topPriceProducts: topPrice });
});
```

**`src/routes/seller.route.js` sau khi sửa:**
```javascript
// Mỗi import chỉ phụ thuộc vào module mình thực sự cần
import * as productModel from '../models/product.model.js';             // write ops
import * as sellerAnalyticsModel from '../models/seller.analytics.model.js'; // seller queries
import * as productCatalogModel from '../models/product.catalog.model.js';   // read queries

router.get('/', async (req, res) => {
  const stats = await sellerAnalyticsModel.getSellerStats(sellerId);  // đúng module
  res.render('vwSeller/dashboard', { stats });
});

router.post('/products/add', async (req, res) => {
  const id = await productModel.addProduct(productData);              // đúng module
  ...
});
```

**Kết quả:** Mỗi route chỉ phụ thuộc vào đúng interface mà nó cần. Thay đổi trong logic thống kê Seller không ảnh hưởng đến trang chủ và ngược lại.
