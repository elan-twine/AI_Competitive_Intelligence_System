// Single source of the per-platform raw-engagement column mapping — i.e. which
// stored DB column is LinkedIn reshares vs X reposts vs Reddit upvotes. Returns
// the RAW stored values (NOT coerced to numbers) so each caller keeps its own
// null/0 handling: the drill-in hides absent metrics (num() → null), while the
// aggregators coerce with Number(x) || 0. If a scraper renames a field, this is
// the one place to change it.
export function extractEngagement(post) {
  switch (post.platform) {
    case 'LinkedIn':
      return { reactions: post.totalReactions, comments: post.comments, reshares: post.reshares }
    case 'X':
      return { likes: post.likeCount, replies: post.replyCount, reposts: post.retweetCount, quotes: post.quoteCount, views: post.viewCount }
    case 'Reddit':
      return { upvotes: post.score, comments: post.numComments }
    default:
      return {}
  }
}
