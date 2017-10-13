#### Mission
* Make sure account tokens are always fresh
* Crawl users || results || timelines || page || search || other feeds of the supported source by Plugr


#### Persitance
* Account model => Mongo/MySQL
* Account health check (token state, usage ratio, freshness Index) => Redis
* Service health check => Redis


#### Interface
* POST /api/v1/search/:source (the actual crawl is done here)
* GET /api/v1/:source/health-check (returns data for the source's accounts and their token freshness)
* GET /api/v1/health-check (returns uptime information, and health check of past hour operations)


#### Outerface
* POST {topics-manager-host}/api/v1/search/:source
    ```js
    {
        feedId: "f6978a986c8967eb6879a6972a1c0a2",
        entity: "profile" || "result" || "social_echo",
        search: [...]
    }
    ```
