class RedisKeys {
  // JWT
  static inboundRequestsByServiceName(serviceName) {
    return `zset:service_name:${serviceName}:timestamp`; // [timestamp, method + path of request]
  }
  //
  static externalRequestsSet() {
    return 'set:external:requests'; // [key1, key2, keys3]
  }
  //
  static externalRequestsTicks(source, clientId, endpointName) {
    // Hard coded key cf. metrics-router.js
    return `zset:crawl_request:source:${source}:clientId:${clientId}:endpointName:${endpointName}:timestamp`; // [timestamp, timestamp]
  }
  //
  static circularSortedSetAccounts(source, endpointName, clientId) {
    if (clientId === undefined || clientId === null) {
      return `zset:circular_sorted_set:source:${source}:timestamp`; // pool of plugr accounts
    }
    return `zset:circular_sorted_set:source:${source}:endpointName:${endpointName}:clientId:${clientId}:timestamp`;
    // [timestamp, timestamp]
  }
  //
  static socialAccountsTokens(source, accountId) {
    return `hmap:social_accounts_tokens:source:${source}:accountId:${accountId}`;
  }
}

module.exports = RedisKeys;
