/* eslint-disable no-unused-vars, class-methods-use-this */
class APIManager {
  /**
     * getPostsByTag - fetched medias for a given tag
     *
     * @param  {string} mandatory, tag (a hashtag, really)
     * @param  {integer} optional, timestampFrom, default = 0
     * @param  {integer} optional, timestampTo, default = moment().unix()
     * @return {object} promise, resolving with a list of trimmed medias, rejecting with an error
     */
  getPostsByTag(tag, timestampFrom, timestampTo) {
    return Promise.reject(new Error('Not implemented'));
  }
  /**
     * getPostsByAuthor - fetches medias for a given authorId
     *
     * @param  {integer} mandatory, an authorId
     * @param  {integer} optional, timestampFrom, default = 0
     * @param  {integer} optional, timestampTo, default = moment().unix()
     * @return {object} promise, resolving with a list of trimmed medias, rejecting with an error
     */
  getPostsByAuthor(authorId, timestampFrom, timestampTo) {
    return Promise.reject(new Error('Not implemented'));
  }
  /**
     * getAuthorById - fetches media for a given mediaId
     *
     * @param  {integer} mandatory, a mediaId
     * @return {object} promise, resolving with a list of trimmed medias, rejecting with an error
     */
  getAuthorById(authorId) {
    return Promise.reject(new Error('Not implemented'));
  }
  /**
     * getPostsByIds - fetches author for a given authorId
     *
     * @param  {integer} mandatory, an authorId
     * @param  {function} optional, callback to be invoked on each crawled media
     * @return {object} promise, resolving with a list of trimmed medias, rejecting with an error
     */
  getPostsByIds(authorId, cb) {
    return Promise.reject(new Error('Not implemented'));
  }
  /**
     * _getEndpointName - fetches media for a given mediaId
     *
     * @param  {string} mandatory, a method
     * @return {object} promise, resolving with a list of trimmed medias, rejecting with an error
     */
  getNormalizedEndpointName(method) {
    switch (method) {
      case 'getPostsByIds':
        return 'postsByIds';
      case 'getPostsByTag':
        return 'searchByTag';
      case 'getPostsByAuthor':
        return 'searchByAuthor';
      case 'getAuthorById':
        return 'authorById';
      case 'getPostsByUrl':
        return 'postsByUrl';
      default:
        return undefined;
    }
  }
}

module.exports = APIManager;
