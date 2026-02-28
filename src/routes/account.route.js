import express from "express";
import bcrypt from "bcryptjs";
import passport from "../utils/passport.js";
import * as userModel from "../models/user.model.js";
import * as upgradeRequestModel from "../models/upgradeRequest.model.js";
import * as watchlistModel from "../models/watchlist.model.js";
import * as reviewModel from "../models/review.model.js";
import * as autoBiddingModel from "../models/autoBidding.model.js";
import { isAuthenticated } from "../middlewares/auth.mdw.js";
import { sendMail } from "../utils/mailer.js";
import { AuthService } from "../services/auth.service.js";
import { CaptchaService } from "../services/captcha.service.js";
import { IdentityProviderFactory } from "../utils/identity.provider.js";

const router = express.Router();

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

router.get("/ratings", isAuthenticated, async (req, res) => {
  const currentUserId = req.session.authUser.id;

  // // Get rating point
  const ratingData = await reviewModel.calculateRatingPoint(currentUserId);
  const rating_point = ratingData ? ratingData.rating_point : 0;
  // // Get all reviews (model already excludes rating=0)
  const reviews = await reviewModel.getReviewsByUserId(currentUserId);

  // // Calculate statistics
  const totalReviews = reviews.length;
  const positiveReviews = reviews.filter((r) => r.rating === 1).length;
  const negativeReviews = reviews.filter((r) => r.rating === -1).length;

  res.render("vwAccount/rating", {
    activeSection: "ratings",
    rating_point,
    reviews,
    totalReviews,
    positiveReviews,
    negativeReviews,
  });
});
// GET /signup
router.get("/signup", function (req, res) {
  // CẬP NHẬT: Truyền Site Key xuống view để hiển thị widget
  res.render("vwAccount/auth/signup", {
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY,
  });
});

// GET /signin
router.get("/signin", function (req, res) {
  const success_message = req.session.success_message;
  delete req.session.success_message;
  res.render("vwAccount/auth/signin", { success_message });
});

// GET /verify-email?email=...
router.get("/verify-email", (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.redirect("/account/signin");
  }

  return res.render("vwAccount/auth/verify-otp", {
    email,
    info_message:
      "We have sent an OTP to your email. Please enter it below to verify your account.",
  });
});

router.get("/forgot-password", (req, res) => {
  res.render("vwAccount/auth/forgot-password");
});
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  const user = await userModel.findByEmail(email);
  if (!user) {
    return res.render("vwAccount/auth/forgot-password", {
      error_message: "Email not found.",
    });
  }
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 phút
  await userModel.createOtp({
    user_id: user.id,
    otp_code: otp,
    purpose: "reset_password",
    expires_at: expiresAt,
  });
  await sendMail({
    to: email,
    subject: "Password Reset for Your Online Auction Account",
    html: `
      <p>Hi ${user.fullname},</p>
      <p>Your OTP code for password reset is: <strong>${otp}</strong></p>
      <p>This code will expire in 15 minutes.</p>
    `,
  });
  return res.render("vwAccount/auth/verify-forgot-password-otp", {
    email,
  });
});
router.post("/verify-forgot-password-otp", async (req, res) => {
  const { email, otp } = req.body;
  const user = await userModel.findByEmail(email);
  const otpRecord = await userModel.findValidOtp({
    user_id: user.id,
    otp_code: otp,
    purpose: "reset_password",
  });
  console.log("Verifying OTP for email:", email, " OTP:", otp);
  if (!otpRecord) {
    console.log("Invalid OTP attempt for email:", email);
    return res.render("vwAccount/auth/verify-forgot-password-otp", {
      email,
      error_message: "Invalid or expired OTP.",
    });
  }
  await userModel.markOtpUsed(otpRecord.id);
  return res.render("vwAccount/auth/reset-password", { email });
});
router.post("/resend-forgot-password-otp", async (req, res) => {
  const { email } = req.body;
  const user = await userModel.findByEmail(email);
  if (!user) {
    return res.render("vwAccount/auth/verify-forgot-password-otp", {
      email,
      error_message: "User not found.",
    });
  }
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 phút
  await userModel.createOtp({
    user_id: user.id,
    otp_code: otp,
    purpose: "reset_password",
    expires_at: expiresAt,
  });
  await sendMail({
    to: email,
    subject: "New OTP for Password Reset",
    html: `
      <p>Hi ${user.fullname},</p>
      <p>Your new OTP code for password reset is: <strong>${otp}</strong></p>
      <p>This code will expire in 15 minutes.</p>
    `,
  });
  return res.render("vwAccount/auth/verify-forgot-password-otp", {
    email,
    info_message:
      "We have sent a new OTP to your email. Please check your inbox.",
  });
});
router.post("/reset-password", async (req, res) => {
  const { email, new_password, confirm_new_password } = req.body;
  if (new_password !== confirm_new_password) {
    return res.render("vwAccount/auth/reset-password", {
      email,
      error_message: "Passwords do not match.",
    });
  }
  const user = await userModel.findByEmail(email);
  if (!user) {
    return res.render("vwAccount/auth/reset-password", {
      email,
      error_message: "User not found.",
    });
  }
  const hashedPassword = bcrypt.hashSync(new_password, 10);
  await userModel.update(user.id, { password_hash: hashedPassword });
  return res.render("vwAccount/auth/signin", {
    success_message: "Your password has been reset. You can sign in now.",
  });
});
// POST /signin
router.post("/signin", async function (req, res) {
  const { email, password } = req.body;

  const user = await userModel.findByEmail(email);
  if (!user) {
    return res.render("vwAccount/auth/signin", {
      error_message: "Invalid email or password",
      old: { email },
    });
  }

  const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
  if (!isPasswordValid) {
    return res.render("vwAccount/auth/signin", {
      error_message: "Invalid email or password",
      old: { email },
    });
  }

  // Chưa verify email -> gửi OTP và chuyển sang trang verify
  if (!user.email_verified) {
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 phút

    await userModel.createOtp({
      user_id: user.id,
      otp_code: otp,
      purpose: "verify_email",
      expires_at: expiresAt,
    });

    await sendMail({
      to: email,
      subject: "Verify your Online Auction account",
      html: `
        <p>Hi ${user.fullname},</p>
        <p>Your OTP code is: <strong>${otp}</strong></p>
        <p>This code will expire in 15 minutes.</p>
      `,
    });

    return res.redirect(
      `/account/verify-email?email=${encodeURIComponent(email)}`,
    );
  }

  // Đã verify -> login bình thường
  req.session.isAuthenticated = true;
  req.session.authUser = user;
  const returnUrl = req.session.returnUrl || "/";
  delete req.session.returnUrl;
  return res.redirect(returnUrl);
});

// POST /signup
router.post("/signup", async function (req, res) {
  const { fullname, email, address, password, confirmPassword } = req.body;

  // --- Lấy token recaptcha từ body ---
  const recaptchaResponse = req.body["g-recaptcha-response"];

  const errors = {};
  const old = { fullname, email, address };

  // 1. Check Captcha via CaptchaService
  const isCaptchaValid = await CaptchaService.verify(recaptchaResponse);
  if (!isCaptchaValid) {
    errors.captcha =
      "Captcha verification failed or missing. Please try again.";
  }

  // 2. Manual Validation
  if (!fullname) errors.fullname = "Full name is required";
  if (!address) errors.address = "Address is required";
  if (!email) errors.email = "Email is required";

  if (!password) errors.password = "Password is required";
  if (password !== confirmPassword) {
    errors.confirmPassword = "Passwords do not match";
  }

  // 3. Register user if no validation errors
  if (Object.keys(errors).length === 0) {
    try {
      const { user, otp } = await AuthService.registerUser({
        email,
        fullname,
        address,
        password,
      });

      // 4. Send Email via Mailer
      const verifyUrl = `${process.env.APP_BASE_URL}/account/verify-email?email=${encodeURIComponent(email)}`;

      await sendMail({
        to: email,
        subject: "Verify your Online Auction account",
        html: `
            <p>Hi ${fullname},</p>
            <p>Thank you for registering at Online Auction.</p>
            <p>Your OTP code is: <strong>${otp}</strong></p>
            <p>This code will expire in 15 minutes.</p>
            <p>You can enter this code on the verification page, or click the link below:</p>
            <p><a href="${verifyUrl}">Verify your email</a></p>
            <p>If you did not register, please ignore this email.</p>
            `,
      });

      // 5. Redirect to verification page
      return res.redirect(
        `/account/verify-email?email=${encodeURIComponent(email)}`,
      );
    } catch (err) {
      if (err.message === "Email is already in use") {
        errors.email = err.message;
      } else {
        console.error("Signup error:", err);
        errors.system =
          "An error occurred during registration. Please try again later.";
      }
    }
  }

  // If there are errors, re-render the form
  return res.render("vwAccount/auth/signup", {
    errors,
    old,
    error_message: "Please correct the errors below.",
  });
});

// POST /verify-email
router.post("/verify-email", async (req, res) => {
  const { email, otp } = req.body;

  const user = await userModel.findByEmail(email);
  if (!user) {
    return res.render("vwAccount/verify-otp", {
      email,
      error_message: "User not found.",
    });
  }

  const otpRecord = await userModel.findValidOtp({
    user_id: user.id,
    otp_code: otp,
    purpose: "verify_email",
  });

  if (!otpRecord) {
    return res.render("vwAccount/auth/verify-otp", {
      email,
      error_message: "Invalid or expired OTP.",
    });
  }

  await userModel.markOtpUsed(otpRecord.id);
  await userModel.verifyUserEmail(user.id);

  req.session.success_message =
    "Your email has been verified. You can sign in now.";
  return res.redirect("/account/signin");
});

// POST /resend-otp
router.post("/resend-otp", async (req, res) => {
  const { email } = req.body;

  const user = await userModel.findByEmail(email);
  if (!user) {
    return res.render("vwAccount/auth/verify-otp", {
      email,
      error_message: "User not found.",
    });
  }

  if (user.email_verified) {
    return res.render("vwAccount/auth/signin", {
      success_message: "Your email is already verified. Please sign in.",
    });
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 phút

  await userModel.createOtp({
    user_id: user.id,
    otp_code: otp,
    purpose: "verify_email",
    expires_at: expiresAt,
  });

  await sendMail({
    to: email,
    subject: "New OTP for email verification",
    html: `
      <p>Hi ${user.fullname},</p>
      <p>Your new OTP code is: <strong>${otp}</strong></p>
      <p>This code will expire in 15 minutes.</p>
    `,
  });

  return res.render("vwAccount/verify-otp", {
    email,
    info_message:
      "We have sent a new OTP to your email. Please check your inbox.",
  });
});

// GET /profile - HIỂN THỊ PROFILE & THÔNG BÁO
router.get("/profile", isAuthenticated, async (req, res) => {
  try {
    const currentUserId = req.session.authUser.id;
    const user = await userModel.findById(currentUserId);

    // 1. Kiểm tra query string "success=true" trên URL
    let success_message = null;
    if (req.query.success === "true") {
      success_message = "Profile updated successfully.";
    }
    if (req.query["send-request-upgrade"] === "true") {
      success_message = "Your upgrade request has been sent successfully.";
    }
    // 2. Render và truyền biến success_message xuống view
    res.render("vwAccount/profile", {
      user: user,
      success_message: success_message, // Nếu null thì HBS sẽ không hiện
    });
  } catch (err) {
    console.error(err);
    res.render("vwAccount/profile", {
      user: req.session.authUser,
      err_message: "Unable to load profile information.",
    });
  }
});

// PUT /profile - XỬ LÝ UPDATE
router.put("/profile", isAuthenticated, async (req, res) => {
  try {
    // 1. Lấy dữ liệu từ form (Bổ sung address)
    const {
      email,
      fullname,
      address,
      date_of_birth,
      old_password,
      new_password,
      confirm_new_password,
    } = req.body;
    const currentUserId = req.session.authUser.id;

    // Lấy thông tin user hiện tại
    const currentUser = await userModel.findById(currentUserId);

    // 2. KIỂM TRA MẬT KHẨU (Giao phó cho Strategy Pattern IdentityProvider)
    const identityProvider = IdentityProviderFactory.getProvider(currentUser);
    try {
      identityProvider.validateProfileUpdate(currentUser, req.body);
    } catch (validationErr) {
      return res.render("vwAccount/profile", {
        user: currentUser,
        err_message: validationErr.message,
      });
    }

    // 3. KIỂM TRA TRÙNG EMAIL
    if (email !== currentUser.email) {
      const existingUser = await userModel.findByEmail(email);
      if (existingUser) {
        return res.render("vwAccount/profile", {
          user: currentUser,
          err_message: "Email is already in use by another user.",
        });
      }
    }

    // 4. CHUẨN BỊ DỮ LIỆU UPDATE
    const entity = identityProvider.prepareUpdateEntity(currentUser, req.body);

    // 6. GỌI MODEL UPDATE (Model đã sửa để trả về Object)
    const updatedUser = await userModel.update(currentUserId, entity);
    console.log("Updated user result:", updatedUser);

    // 7. CẬP NHẬT SESSION
    if (updatedUser) {
      delete updatedUser.password_hash;
      req.session.authUser = updatedUser;
    }

    // 8. THÀNH CÔNG -> Redirect về trang profile kèm query success
    return res.redirect("/account/profile?success=true");
  } catch (err) {
    console.error(err);
    return res.render("vwAccount/profile", {
      user: req.session.authUser,
      err_message: "System error. Please try again later.",
    });
  }
});
router.post("/logout", isAuthenticated, (req, res) => {
  req.session.isAuthenticated = false;
  delete req.session.authUser;
  res.redirect("/");
});
router.get("/request-upgrade", isAuthenticated, async (req, res) => {
  const currentUserId = req.session.authUser.id;
  const upgradeRequest = await upgradeRequestModel.findByUserId(currentUserId);
  res.render("vwAccount/request-upgrade", { upgrade_request: upgradeRequest });
});
router.post("/request-upgrade", isAuthenticated, async (req, res) => {
  try {
    const currentUserId = req.session.authUser.id;
    await userModel.markUpgradePending(currentUserId);
    await upgradeRequestModel.createUpgradeRequest(currentUserId);
    return res.redirect("/account/profile?send-request-upgrade=true");
  } catch (err) {
    console.error(err);
    res.render("vwAccount/profile", {
      user: req.session.authUser,
      err_message:
        "Unable to submit your request at this time. Please try again later.",
    });
  }
});
router.get("/watchlist", isAuthenticated, async (req, res) => {
  const limit = 3;
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * limit;
  // Implementation for watchlist route
  const currentUserId = req.session.authUser.id;
  const watchlistProducts = await watchlistModel.searchPageByUserId(
    currentUserId,
    limit,
    offset,
  );
  const total = await watchlistModel.countByUserId(currentUserId);
  const totalCount = Number(total.count);
  const nPages = Math.ceil(totalCount / limit);
  let from = (page - 1) * limit + 1;
  let to = page * limit;
  if (to > totalCount) to = totalCount;
  if (totalCount === 0) {
    from = 0;
    to = 0;
  }
  res.render("vwAccount/watchlist", {
    products: watchlistProducts,
    totalCount,
    from,
    to,
    currentPage: page,
    totalPages: nPages,
  });
});

// Bidding Products - Sản phẩm đang tham gia đấu giá
router.get("/bidding", isAuthenticated, async (req, res) => {
  const currentUserId = req.session.authUser.id;
  const biddingProducts =
    await autoBiddingModel.getBiddingProductsByBidderId(currentUserId);

  res.render("vwAccount/bidding-products", {
    activeSection: "bidding",
    products: biddingProducts,
  });
});

// Won Auctions - Sản phẩm đã thắng (pending, sold, cancelled)
router.get("/auctions", isAuthenticated, async (req, res) => {
  const currentUserId = req.session.authUser.id;
  const wonAuctions =
    await autoBiddingModel.getWonAuctionsByBidderId(currentUserId);

  // Check if user has rated seller for each product
  for (let product of wonAuctions) {
    const review = await reviewModel.findByReviewerAndProduct(
      currentUserId,
      product.id,
    );
    // Only show rating if it's not 0 (actual rating, not skip)
    if (review && review.rating !== 0) {
      product.has_rated_seller = true;
      product.seller_rating = review.rating === 1 ? "positive" : "negative";
      product.seller_rating_comment = review.comment;
    } else {
      product.has_rated_seller = false;
    }
  }

  res.render("vwAccount/won-auctions", {
    activeSection: "auctions",
    products: wonAuctions,
  });
});

// Rate Seller - POST
router.post(
  "/won-auctions/:productId/rate-seller",
  isAuthenticated,
  async (req, res) => {
    try {
      const currentUserId = req.session.authUser.id;
      const productId = req.params.productId;
      const { seller_id, rating, comment } = req.body;

      // Validate rating
      const ratingValue = rating === "positive" ? 1 : -1;

      // Check if already rated
      const existingReview = await reviewModel.findByReviewerAndProduct(
        currentUserId,
        productId,
      );
      if (existingReview) {
        // Update existing review instead of creating new
        await reviewModel.updateByReviewerAndProduct(currentUserId, productId, {
          rating: ratingValue,
          comment: comment || null,
        });
      } else {
        // Create new review
        await reviewModel.create({
          reviewer_id: currentUserId,
          reviewed_user_id: seller_id,
          product_id: productId,
          rating: ratingValue,
          comment: comment || null,
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error rating seller:", error);
      res.json({ success: false, message: "Failed to submit rating." });
    }
  },
);

// Rate Seller - PUT (Edit)
router.put(
  "/won-auctions/:productId/rate-seller",
  isAuthenticated,
  async (req, res) => {
    try {
      const currentUserId = req.session.authUser.id;
      const productId = req.params.productId;
      const { rating, comment } = req.body;

      const ratingValue = rating === "positive" ? 1 : -1;

      // Update review
      await reviewModel.updateByReviewerAndProduct(currentUserId, productId, {
        rating: ratingValue,
        comment: comment || null,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error updating rating:", error);
      res.json({ success: false, message: "Failed to update rating." });
    }
  },
);

router.get("/seller/products", isAuthenticated, async (req, res) => {
  res.render("vwAccount/my-products");
});

router.get("/seller/sold-products", isAuthenticated, async (req, res) => {
  res.render("vwAccount/sold-products");
});

// ===================== OAUTH ROUTES =====================

// Google OAuth
router.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] }),
);

router.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/account/signin" }),
  (req, res) => {
    // Lưu user vào session
    req.session.authUser = req.user;
    req.session.isAuthenticated = true;
    res.redirect("/");
  },
);

// Facebook OAuth
// NOTE: 'email' scope chỉ hoạt động với Admin/Developer/Tester trong Development Mode
// Tạm thời chỉ dùng 'public_profile' để test, sau đó thêm 'email' khi đã add tester
router.get(
  "/auth/facebook",
  passport.authenticate("facebook", { scope: ["public_profile"] }),
);

router.get(
  "/auth/facebook/callback",
  passport.authenticate("facebook", { failureRedirect: "/account/signin" }),
  (req, res) => {
    req.session.authUser = req.user;
    req.session.isAuthenticated = true;
    res.redirect("/");
  },
);

// Twitter OAuth - DISABLED (Twitter API requires $100/month subscription)
// router.get('/auth/twitter',
//   passport.authenticate('twitter')
// );

// router.get('/auth/twitter/callback',
//   passport.authenticate('twitter', { failureRedirect: '/account/signin' }),
//   (req, res) => {
//     req.session.authUser = req.user;
//     req.session.isAuthenticated = true;
//     res.redirect('/');
//   }
// );

// GitHub OAuth
router.get(
  "/auth/github",
  passport.authenticate("github", { scope: ["user:email"] }),
);

router.get(
  "/auth/github/callback",
  passport.authenticate("github", { failureRedirect: "/account/signin" }),
  (req, res) => {
    req.session.authUser = req.user;
    req.session.isAuthenticated = true;
    res.redirect("/");
  },
);

export default router;
