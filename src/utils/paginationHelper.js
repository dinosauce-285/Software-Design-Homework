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
