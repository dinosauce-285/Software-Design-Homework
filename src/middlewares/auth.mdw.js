import { hasPermission } from "../utils/rbac.js";

export function isAuthenticated(req, res, next) {
  if (req.session.isAuthenticated) {
    next();
  } else {
    req.session.returnUrl = req.originalUrl;
    res.redirect("/account/signin");
  }
}

/**
 * Middleware factory for Role-Based Access Control
 * Mitigates OCP violation by relying on permission evaluation rather than hard-coded roles.
 * @param {string} permission
 */
export function requirePermission(permission) {
  return (req, res, next) => {
    // Must be authenticated first
    if (!req.session.isAuthenticated || !req.session.authUser) {
      req.session.returnUrl = req.originalUrl;
      return res.redirect("/account/signin");
    }

    const role = req.session.authUser.role;

    // Check using RBAC utility
    if (hasPermission(role, permission)) {
      next();
    } else {
      res.status(403).render("403", {
        message: "You do not have permission to perform this action",
      });
    }
  };
}
