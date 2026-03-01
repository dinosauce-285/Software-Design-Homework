# Phân tích vi phạm nguyên lý KISS trong dự án Auction Web

Dựa trên quá trình phân tích mã nguồn của dự án Auction Web, nhóm chúng em đã phát hiện các vi phạm về nguyên lý KISS (Keep It Simple, Stupid).

---

## Nguyên lý KISS (Keep It Simple, Stupid)

**Định nghĩa:** Hệ thống hoạt động tốt nhất khi nó được giữ đơn giản thay vì làm cho phức tạp. Code phức tạp, lồng ghép quá nhiều logic vào một hàm sẽ dẫn đến khó đọc, khó hiểu, khó debug và cực kỳ nguy hiểm khi bảo trì (Spaghetti code). Mỗi hàm/phương thức chỉ nên đảm nhiệm một luồng xử lý rõ ràng.

### Vị trí vi phạm số 1: God Function / Spaghetti Route
- **File:** `src/routes/product.route.js`
- **Chức năng:** Xử lý logic đặt giá (Bidding) ở Router `POST /bid`.

### Mã nguồn hiện tại
Route `POST /bid` trải dài từ dòng 336 đến khoảng dòng 788 (**hơn 450 dòng code liên tục**). Đoạn code này thực hiện nhồi nhét *tất cả mọi thứ* trong một cục duy nhất:

1. Validate input đầu vào.
2. Khởi tạo một Transaction Database khổng lồ (Row-level Locking).
3. Hàng loạt câu `if-else` lồng nhau kiểm tra rẽ nhánh: Sản phẩm đã bán chưa? Chủ sở hữu có tự bid không? User có bị block không? Điểm đánh giá (Rating) có hợp lệ không? Đã đóng siêu phẩm chưa? Tiền bid có đủ bước giá chưa? Cần auto-extend thời gian không?...
4. Thuật toán **Automatic Bidding** cực kì phức tạp (tự động đấu giá giùm, so sánh các mốc max price, v.v.).
5. Cập nhật bảng `products`, insert `bidding_history`, upsert `auto_bidding`...
6. Và cuối cùng, xen lẫn ngay bên dưới là một khối IIFE (Immediately Invoked Function Expression) bất đồng bộ khổng lồ dài cả trăm dòng chứa toàn chuỗi HTML thuần (Hard-coded) để gửi Email thông báo cho Seller, cho người thắng cuộc và cho người thua cuộc.

*Một phần trích xuất thuật toán lồng ghép (dòng 466-515):*
```javascript
      // Only run normal auto-bidding if buy_now not triggered by existing bidder
      if (!buyNowTriggered) {
        // Case 0: Người đặt giá chính là người đang giữ giá cao nhất
        if (product.highest_bidder_id === userId) {
          // Chỉ update max_price trong auto_bidding
          newCurrentPrice = parseFloat(product.current_price || product.starting_price);
          // ...
        }
        // Case 1: Chưa có người đấu giá nào (first bid)
        else if (!product.highest_bidder_id || !product.highest_max_price) {
          // ...
        } 
        // Case 2: Đã có người đấu giá trước đó
        else {
          const currentHighestMaxPrice = parseFloat(product.highest_max_price);
          // ...
          // Case 2a: bidAmount < giá tối đa của người cũ
          if (bidAmount < currentHighestMaxPrice) {
            // ...
          }
          // Case 2b: bidAmount == giá tối đa của người cũ
          else if (bidAmount === currentHighestMaxPrice) {
            // ...
          }
          // Case 2c: bidAmount > giá tối đa của người cũ
          else {
            // ...
          }
        }
      }
```

### Nguyên nhân và Đánh giá tác động
Nguyên nhân là do việc thiếu phân chia lớp ứng dụng (Application Layering). Lập trình viên xử lý toàn bộ logic nghiệp vụ (Business Logic), truy cập cơ sở dữ liệu (Data Access) và hiển thị/thông báo (Presentation/Notification) ngay tại tầng Router (Controller).
- **Tác động bảo trì:** 
  1. Rất khó để hiểu được dòng chảy nghiệp vụ (Flow) của chức năng Đấu giá nếu một lập trình viên mới đọc vào đoạn code 450 dòng này.
  2. Viết Unit Test cho thuật toán Auto-Bidding là **bất khả thi** vì nó bị dính chặt (tight-coupling) vào đối tượng `req, res`, vào database transaction (`trx`) và tiến trình gửi email. 
  3. Bất kỳ lỗi typo nhỏ nào trong việc tạo string HTML email cũng nằm chung chỗ với logic trừ tiền/đặt giá Database, gây rủi ro lọt bug logic nghiệp vụ.

### Giải pháp cải thiện
Áp dụng **Facade Pattern** hoặc chia kiến trúc theo **Service-Layer**. Route chỉ nên đảm nhận việc nhận dữ liệu `req`, gọi Service và trả về `res`. Khâu gửi email phải được tách hoàn toàn ra một hệ thống xử lý Sự kiện (Event-driven) hoặc Queue độc lập (Tách biệt logic cốt lõi với side-effect).

**Cách cấu trúc lại (Refactor):**

1. Tách thuật toán Automatic Bidding ra một file riêng để dễ test (Pure Function).
```javascript
// src/services/bidding.service.js
export function calculateNewBidState(currentProductState, newBidAction) {
  // Toàn bộ cục if-else ở trên chuyển vào đây. 
  // Nhận input là state hiện tại, trả ra state mới. Không có DB!
  return { newPrice, newWinner, ... }; 
}
```

2. Tách chức năng Template Email ra riêng:
```javascript
// src/services/email.service.js
export async function sendOutbidNotification(userEmail, productInfo) {
    const htmlTemplate = await renderTemplate('outbid-email', productInfo); // Không hard-code HTML dài dằng dặc trong route
    await sendMail(userEmail, "You've been outbid!", htmlTemplate);
}
```

3. Route trở nên rất ngắn gọn như thiết kế ban đầu (KISS):
```javascript
// src/routes/product.route.js
router.post('/bid', isAuthenticated, async (req, res) => {
  try {
    const { productId, bidAmount } = req.body;
    
    // Gọi tằng Service thực thi 
    const result = await BiddingService.placeBid(req.session.authUser.id, productId, bidAmount);
    
    // Fire Event gửi mail bất đồng bộ (Không chờ)
    EventEmitter.emit('BID_PLACED', result);
    
    req.session.success_message = result.message;
    res.redirect(`/products/detail?id=${productId}`);
  } catch(error) {
    req.session.error_message = error.message;
    res.redirect(`/products/detail?id=${productId}`);
  }
});
```
Với cấu trúc này, ta giữ được tính đơn giản (Simplicity) cho từng thành phần. Mỗi module chỉ tập trung vào một vấn đề nhỏ.

---

### Vị trí vi phạm số 2: Lạm dụng Callback lồng lộn (Callback Hell / Nested Logic) trong Knex
- **File:** `src/models/autoBidding.model.js`
- **Chức năng:** Lấy các sản phẩm đấu giá thành công dựa vào điều kiện ngày tháng và trạng thái (`getWonAuctionsByBidderId`).

### Mã nguồn hiện tại
Đoạn Query Builder trong Model được xây dựng với **4 cấp lồng (`.where(function() { ... })`)** để gom nhóm các mệnh đề AND/OR trong SQL.

*Ví dụ ở dòng 103-114:*
```javascript
    .where(function() {
      this.where(function() {
        // Pending: (end_at <= NOW OR closed_at) AND is_sold IS NULL
        this.where(function() {
          this.where('products.end_at', '<=', new Date())
            .orWhereNotNull('products.closed_at');
        }).whereNull('products.is_sold');
      })
      .orWhere('products.is_sold', true)   // Sold
      .orWhere('products.is_sold', false); // Cancelled
    })
```

### Nguyên nhân và Đánh giá tác động
Knex hỗ trợ cách phân cấp `.where` bằng callback để đóng mở ngoặc trong SQL `(A AND B) OR C`. Tuy nhiên, lập trình viên vì muốn ôm hết rẽ nhánh logic vào một lệnh duy nhất nên đã tạo ra "kim tự tháp" callback lồng nhau.
- **Tác động bảo trì:** 
  1. Rất khó đọc hiểu: Người bảo trì phải mất thời gian ngồi đếm số cặp ngoặc để biết dòng 110 `.whereNull()` đang OR hay AND với dòng 111 `.orWhere(...)`.
  2. Vi phạm tính đơn giản (KISS): Đoạn code SQL thô (Raw SQL) tương đương có khi còn dễ đọc và ngắn gọn hơn cái đống lồng nhau này. Khi một Query Builder làm code JS trở nên phức tạp hơn SQL thuần, đó là một thất bại về mặt thiết kế.

### Giải pháp cải thiện
**Cách 1: Sử dụng Raw SQL trực tiếp cho phần mệnh đề WHERE phức tạp**
Thay vì dồn ép bằng Callback, chỉ cần 1 dòng `whereRaw` rõ ràng là giải quyết được độ vướng mắt.

```javascript
    // Dễ đọc giống hệt SQL truyền thống
    .whereRaw(`
      (
        ((products.end_at <= NOW() OR products.closed_at IS NOT NULL) AND products.is_sold IS NULL)
        OR products.is_sold = true 
        OR products.is_sold = false
      )
    `)
```

**Cách 2: Tách điều kiện ra các biến boolean trong Database Query (Nếu muốn giữ Knex)**
```javascript
```javascript
  const isPendingCondition = builder => {
    builder.where(function() {
      this.where('products.end_at', '<=', new Date())
          .orWhereNotNull('products.closed_at');
    }).whereNull('products.is_sold');
  };

  return db('products')
    // ... join
    .where('products.highest_bidder_id', bidderId)
    .andWhere(function() {
      // Dễ đọc hơn rất nhiều
      this.where(isPendingCondition)
          .orWhere('products.is_sold', true)
          .orWhere('products.is_sold', false);
    });
```
Việc đặt tên cho các hàm logic trung gian (`isPendingCondition`) giúp tự tài liệu hóa code và tuân thủ đúng nguyên lý "Keep It Simple, Stupid!".

---

### Vị trí vi phạm số 3: Viết mã HTML thô (Hard-coded HTML) trong Controller
- **File:** `src/routes/product.route.js`
- **Chức năng:** Lấy tin nhắn Chat của Order (`GET /order/:orderId/messages`)

### Mã nguồn hiện tại
Để làm chức năng chat theo thời gian thực (hoặc lấy tin nhắn cũ), thay vì trả về dữ liệu thuần (JSON) hoặc Delegate cho View Engine (Handlebars), lập trình viên lại dùng vòng lặp `forEach` cộng dồn từng dòng chuỗi HTML vào một biến `messagesHtml` ngay trong Router.

*Đoạn mã (Dòng 1392-1419):*
```javascript
    // Generate HTML for messages
    let messagesHtml = '';
    messages.forEach(msg => {
      const isSent = msg.sender_id === userId;
      const messageClass = isSent ? 'text-end' : '';
      const bubbleClass = isSent ? 'sent' : 'received';
      
      // Format date: HH:mm:ss DD/MM/YYYY
      const msgDate = new Date(msg.created_at);
      // Hàng loạt khai báo year, month, day, hour lặp đi lặp lại cục súc...
      const formattedDate = \`\${hour}:\${minute}:\${second} \${day}/\${month}/\${year}\`;
      
      messagesHtml += \`
        <div class="chat-message \${messageClass}">
          <div class="chat-bubble \${bubbleClass}">
            <div>\${msg.message}</div>
            <div style="font-size: 0.7rem; margin-top: 3px; opacity: 0.8;">\${formattedDate}</div>
          </div>
        </div>
      \`;
    });
    
    res.json({ success: true, messagesHtml });
```

### Nguyên nhân và Đánh giá tác động
Lập trình viên muốn API trả về một cục HTML trộn sẵn để frontend ráp thẳng vào DOM (để tiết kiệm code ở Client). 
- **Tác động bảo trì:** 
  1. Vi phạm nghiêm trọng nguyên lý chia tách mối quan tâm (Separation of Concerns). Route (Backend) không có nhiệm vụ định dạng giao diện (Front-end).
  2. Rất dễ dính lỗi cú pháp: Việc rải rác HTML trong các chuỗi String (Backticks) không được trình tự động kiểm tra lỗi (Syntax Highlighter). Viết sai thẻ đóng hay thiếu nháy kép ở các `class="chat-message..."` rất khó debug.
  3. Lỗ hổng bảo mật XSS (Cross-Site Scripting): Biến `${msg.message}` được bắn thẳng vào DOM bằng String Concatenation mà **không qua Escape** kí tự. Nếu người dùng nhập `<script>alert('hack')</script>`, trình duyệt sẽ chạy ngay đoạn script đó. (Handlebars mặc định có escape thẻ script, còn nối chuỗi tay thì không).

### Giải pháp cải thiện
Trả về JSON thuần túy (Raw Data) và để Frontend hoặc Handlebars lo phần giao diện.

**Cách 1: Trả mảng JSON thông thường, dùng JS Frontend để render (Tách biệt Client-Server)**
```javascript
// Server (Controller)
router.get('/order/:orderId/messages', async (req, res) => {
  // ... check auth
  const messages = await orderChatModel.getMessagesByOrderId(orderId);
  // Trả về dữ liệu chuẩn JSON cho API
  res.json({ 
    success: true, 
    data: messages.map(msg => ({
      message: msg.message, // JS Frontend tự escape nội dung này
      isSent: msg.sender_id === userId,
      createdAt: msg.created_at // JS Frontend sẽ tự format Date (VD: dùng dayjs)
    })) 
  });
});
```

**Cách 2: Nếu kiên quyết muốn render HTML từ Server, hãy dùng Res.render (Partial Template)**
Tạo một file Handlebars ẩn: `views/partials/chatMessage.hbs`
Và tại Controller:
```javascript
  const messages = await orderChatModel.getMessagesByOrderId(orderId);
  // Hàm res.render có thể trả về một string HTML từ View Engine (Có cơ chế tự động Escape XSS)
  res.render('partials/chatMessage', { messages, currentUserId: userId }, (err, html) => {
     res.json({ success: true, messagesHtml: html });
  });
```
