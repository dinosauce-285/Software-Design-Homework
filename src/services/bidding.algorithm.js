/**
 * Pure function to calculate the new state of a product after a bid is placed.
 * It handles the complex logic of automatic bidding.
 * 
 * @param {Object} state - current product state
 * @param {Object} action - the new bid action (userId, bidAmount)
 * @returns {Object} new state of the product
 */
export function calculateNewBidState(state, action) {
    const { product, buyNowPrice, currentPrice, minIncrement } = state;
    const { userId, bidAmount } = action;

    let newCurrentPrice;
    let newHighestBidderId;
    let newHighestMaxPrice;
    let shouldCreateHistory = true;
    let buyNowTriggered = false;

    // First-come-first-served handling for buy_now_price
    if (
        buyNowPrice &&
        product.highest_bidder_id &&
        product.highest_max_price &&
        product.highest_bidder_id !== userId
    ) {
        const currentHighestMaxPrice = parseFloat(product.highest_max_price);

        // If current highest bidder already bid >= buy_now, they win immediately
        if (currentHighestMaxPrice >= buyNowPrice) {
            newCurrentPrice = buyNowPrice;
            newHighestBidderId = product.highest_bidder_id;
            newHighestMaxPrice = currentHighestMaxPrice;
            buyNowTriggered = true;
        }
    }

    // Normal auto-bidding if buy_now not triggered by existing bidder
    if (!buyNowTriggered) {
        // Case 0: The bidder is already the highest bidder
        if (product.highest_bidder_id === userId) {
            newCurrentPrice = parseFloat(product.current_price || product.starting_price);
            newHighestBidderId = userId;
            newHighestMaxPrice = bidAmount;
            shouldCreateHistory = false;
        }
        // Case 1: First bid on the product
        else if (!product.highest_bidder_id || !product.highest_max_price) {
            newCurrentPrice = parseFloat(product.starting_price);
            newHighestBidderId = userId;
            newHighestMaxPrice = bidAmount;
        }
        // Case 2: There is an existing highest bidder
        else {
            const currentHighestMaxPrice = parseFloat(product.highest_max_price);
            const currentHighestBidderId = product.highest_bidder_id;

            // Case 2a: New bid is less than existing max price
            if (bidAmount < currentHighestMaxPrice) {
                newCurrentPrice = bidAmount;
                newHighestBidderId = currentHighestBidderId;
                newHighestMaxPrice = currentHighestMaxPrice;
            }
            // Case 2b: New bid equals existing max price
            else if (bidAmount === currentHighestMaxPrice) {
                newCurrentPrice = bidAmount;
                newHighestBidderId = currentHighestBidderId;
                newHighestMaxPrice = currentHighestMaxPrice;
            }
            // Case 2c: New bid is strictly greater than existing max price
            else {
                newCurrentPrice = currentHighestMaxPrice + minIncrement;
                newHighestBidderId = userId;
                newHighestMaxPrice = bidAmount;
            }
        }

        // Check if buy now price is reached after auto-bidding
        if (buyNowPrice && newCurrentPrice >= buyNowPrice) {
            newCurrentPrice = buyNowPrice;
            buyNowTriggered = true;
        }
    }

    const productSold = buyNowTriggered;

    return {
        newCurrentPrice,
        newHighestBidderId,
        newHighestMaxPrice,
        shouldCreateHistory,
        productSold,
    };
}
