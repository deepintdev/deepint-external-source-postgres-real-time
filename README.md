# Deep Intelligence External source: PostgreSQL + MQTT

This is an external source manager based on PostgreSQL for data storage and MQTT for real-time data fetching.

## Installation

Install depedendencies

```
$ npm install
```

Requirements:

 - Node JS

To build the project type:

```
$ npm run build
```

To run the server type:

```
$ npm start
```

## Configuration

In order to configure this module, you have to set the following environment variables:

| Variable Name   | Description                                                                     |
| --------------- | ------------------------------------------------------------------------------- |
| HTTP_PORT       | HTTP listening port. Default is `80`                                            |
| SSL_PORT        | HTTPS listening port. Default is `443`                                          |
| SSL_CERT        | Path to SSL certificate. Required for HTTPS to work                             |
| SSL_KEY         | Path to SSL private key. Required for HTTPS to work                             |
| LOG_MODE        | Log Mode. values: DEFAULT, SILENT, DEBUG                                        |
| API_DOCS        | Set it to `YES` to generate Swagger api documentation in the `/api-docs/` path. |
| DEEPINT_API_URL | Deep Intelligence API URL, by default is `https://app.deepint.net/api/v1/`      |

In order to configure the source, set the following variables:

| Variable Name      | Description                                       |
| ------------------ | ------------------------------------------------- |
| PG_HOST            | Postgre host                                      |
| PG_PORT            | Postgre port. Default: `5432`                     |
| PG_USER            | Postgre username.                                 |
| PG_PASSWORD        | Postgre password.                                 |
| PG_DB_NAME         | Postgre database name.                            |
| PG_MAX_CONNECTIONS | Max connections in the Postgre connection pool.   |
| TABLE_MAPPING_FILE | Path to the tables mapping file. Explained below. |

For MQTT real-time inserts, configure the following variables:

| Variable Name | Description                                                          |
| ------------- | -------------------------------------------------------------------- |
| MQTT_URL      | Connection URL for MQTT server. Example: `mqtt://test.mosquitto.org` |
| MQTT_USER     | Username for MQTT authentication (if required)                       |
| MQTT_PASSWORD | password for MQTT authentication (if required)                       |

In order to configure the table mapping rules, create a JSON file and set its path into the `TABLE_MAPPING_FILE` variable.

The tables mapping file contains an array with the following structure:

```json
[
    {
        "table": "Table of the PostgreSQL table",

        "publicKey": "Public Key for the source (An unique identifier)",
        "secretKey": "Private Key to access the API for this source (A random string)",

        "fields": [
            {
                "name": "Feature name. Name of the field in the database",
                "type": "Feature type. Can be: NOMINAL, NUMERIC, LOGIC, DATE or TEXT"
            }
        ],

        "topic": "Name of the MQTT topic to subscribe to."
    }
]
```

For each table you can set a MQTT topic in order to listen for new instances. Those instances are expected as JSON objects, being the keys the names of the fields. Example:

```json
{"sepallength":6.9,"sepalwidth":3.1,"petallength":5.1,"petalwidth":2.3,"species":"virginica"}
```



