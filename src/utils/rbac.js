/**
 * RBAC System (Role-Based Access Control)
 * Defines permissions and roles to mitigate OCP violations in authorization middleware.
 */

// Define all possible permissions in the system
export const Permissions = {
  // Product Permissions
  CREATE_PRODUCT: "CREATE_PRODUCT",
  EDIT_PRODUCT: "EDIT_PRODUCT",
  DELETE_PRODUCT: "DELETE_PRODUCT",
  VIEW_OWN_PRODUCTS: "VIEW_OWN_PRODUCTS",
  VIEW_ALL_PRODUCTS: "VIEW_ALL_PRODUCTS",

  // User/Admin Permissions
  MANAGE_USERS: "MANAGE_USERS",
  MANAGE_UPGRADE_REQUESTS: "MANAGE_UPGRADE_REQUESTS",
  MANAGE_CATEGORIES: "MANAGE_CATEGORIES",

  // Bidding Permissions
  PLACE_BID: "PLACE_BID",
  ADD_WATCHLIST: "ADD_WATCHLIST",
};

// Define Roles and their associated array of permissions
export const RolePermissions = {
  bidder: [Permissions.PLACE_BID, Permissions.ADD_WATCHLIST],
  seller: [
    Permissions.PLACE_BID,
    Permissions.ADD_WATCHLIST,
    Permissions.CREATE_PRODUCT,
    Permissions.EDIT_PRODUCT,
    Permissions.VIEW_OWN_PRODUCTS,
  ],
  admin: [
    Permissions.MANAGE_USERS,
    Permissions.MANAGE_UPGRADE_REQUESTS,
    Permissions.MANAGE_CATEGORIES,
    Permissions.DELETE_PRODUCT,
    Permissions.VIEW_ALL_PRODUCTS,
  ],
};

/**
 * Checks if a specific role contains a given permission.
 * @param {string} role - The role of the user (e.g., 'seller', 'admin')
 * @param {string} permission - The required permission from Permissions object
 * @returns {boolean} True if the role has the permission, false otherwise
 */
export function hasPermission(role, permission) {
  if (!role || !RolePermissions[role]) {
    return false;
  }
  return RolePermissions[role].includes(permission);
}
