// Configuration

"use strict";

import { ObjectSchema } from "@asanrom/javascript-object-sanitizer";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { FeatureType } from "./utils/deepint-sources";

dotenv.config(); // Load env variables

export interface DataSourceConfig {
    maxConnections: number;

    host: string;
    port: number;

    user: string;
    password: string;

    database: string;
}

export interface DataSourceTableConfig {
    table: string;

    publicKey: string;
    secretKey: string;

    fields: {
        type: FeatureType;
        name: string;
    }[],

    topic: string,
}

const DataSourceTableSchema = ObjectSchema.array(ObjectSchema.object({
    table: ObjectSchema.string(),
    publicKey: ObjectSchema.string(),
    secretKey: ObjectSchema.string(),
    fields: ObjectSchema.array(ObjectSchema.object({
        type: ObjectSchema.string().withEnumeration(['NOMINAL', 'TEXT', 'NUMERIC', 'LOGIC', 'DATE']),
        name: ObjectSchema.string(),
    })),
    topic: ObjectSchema.optional(ObjectSchema.string()),
}));

/**
 * Configuration class
 */
export class Config {

    public static instance: Config;

    public static getInstance() {
        if (Config.instance) {
            return Config.instance;
        }

        Config.instance = new Config();

        return Config.instance;
    }

    public httpPort: number;

    public sslEnabled: boolean;
    public sslPort: number;
    public sslCert: string;
    public sslKey: string;

    public apiDocs: boolean;

    public dataSource: DataSourceConfig;
    public tablesConfig: DataSourceTableConfig[];

    public deepintURL: string;

    public mqttURL: string;
    public mqttUser: string;
    public mqttPassword: string;

    public logEvents: boolean;
    public logDebug: boolean;
    public logType: number;

    constructor() {
        // Ports
        this.httpPort = parseInt(process.env.HTTP_PORT, 10) || 80;
        this.sslPort = parseInt(process.env.SSL_PORT, 10) || 443;

        // SSL
        this.sslCert = process.env.SSL_CERT || "";
        this.sslKey = process.env.SSL_KEY || "";
        this.sslEnabled = !!(this.sslKey && this.sslCert);

        // Source
        this.dataSource = {
            host: process.env.PG_HOST || "localhost",
            port: parseInt(process.env.PG_PORT, 10) || 5432,
            user: process.env.PG_USER || "postgres",
            password: process.env.PG_PASSWORD || "",
            database: process.env.PG_DB_NAME || "test",
            maxConnections: parseInt(process.env.PG_MAX_CONNECTIONS, 10) || 4
        };

        this.tablesConfig = [];

        if (process.env.TABLE_MAPPING_FILE) {
            const tableMappingData = JSON.parse(readFileSync(process.env.TABLE_MAPPING_FILE).toString());
            if (!DataSourceTableSchema.test(tableMappingData)) {
                throw new Error("Invalid table mappings, check the documentation.");
            }
            this.tablesConfig = DataSourceTableSchema.sanitize(tableMappingData);
        }


        this.deepintURL = process.env.DEEPINT_API_URL || "https://app.deepint.net/api/v1/";

        this.mqttURL = process.env.MQTT_URL || "mqtt://localhost";
        this.mqttUser = process.env.MQTT_USER || "";
        this.mqttPassword = process.env.MQTT_PASSWORD || "";

        const logMode = process.env.LOG_MODE + "";

        switch (logMode.toUpperCase()) {
        case "SILENT":
            this.logEvents = false;
            this.logDebug = false;
            this.logType = 1;
            break;
        case "DEBUG":
            this.logEvents = true;
            this.logDebug = true;
            this.logType = 3;
            break;
        default:
            this.logEvents = true;
            this.logDebug = false;
            this.logType = 2;
        }

        // API docs

        this.apiDocs = ((process.env.API_DOCS + "").toUpperCase() !== "NO");
    }
}
