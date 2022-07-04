// Source manager

"use strict";

import { Pool } from "pg";
import Cursor from "pg-cursor";
import { AsyncSemaphore } from "@asanrom/async-tools";
import { Config } from "./config";
import { Feature, FeatureType, InstanceType, QueryTree, replaceWildcards, sanitizeQueryTree, toSQLCondition, turnInto } from "./utils/deepint-sources";
import { Request } from "./utils/request";
import { secureStringCompare, toPostgresTemplate } from "./utils/text";

const DEEPINT_UPDATE_INSTANCES_LIMIT = 100;
const CURSOR_READ_AMOUNT = 100;

export interface DataSourceConfiguration {
    maxConnections: number;

    host: string;
    port: number;

    user: string;
    password: string;

    database: string;
}

export interface DataSourceTable {
    table: string;

    publicKey: string;
    secretKey: string;

    fields: Feature[];

    updateSem: AsyncSemaphore;

    updateQueue: InstanceType[][];

    requiredUpdate: boolean;
}

export class DataSource {
    public static instance: DataSource;

    public static getInstance() {
        if (DataSource.instance) {
            return DataSource.instance;
        }

        DataSource.instance = new DataSource(Config.getInstance().dataSource);

        return DataSource.instance;
    }

    public config: DataSourceConfiguration;
    public tables: DataSourceTable[];
    public pool: Pool;

    public closed: boolean;

    constructor(config: DataSourceConfiguration) {
        this.config = config;
        this.tables = Config.getInstance().tablesConfig.map(t => {
            return {
                table: t.table,
                publicKey: t.publicKey,
                secretKey: t.secretKey,
                fields: t.fields.map((f, i) => {
                    return {
                        index: i,
                        name: f.name,
                        type: <FeatureType>f.type.toLowerCase(),
                    };
                }),

                updateSem: new AsyncSemaphore(0),
                updateQueue: [],
                requiredUpdate: false,
            };
        });

        this.pool = new Pool({
            /* Single connection for sequential workers, multiple connections for server workers */
            max: config.maxConnections || 4,
            host: config.host,
            port: config.port || 5432,
            user: config.user,
            password: config.password,
            database: config.database,
            parseInputDatesAsUTC: true,
        });

        this.closed = false;
    }

    public getTableFromCredentials(pubkey: string, secKey: string): DataSourceTable {
        for (const table of this.tables) {
            if (secureStringCompare(pubkey, table.publicKey) && secureStringCompare(secKey, table.secretKey)) {
                return table;
            }
        }

        return null;
    }

    private async sendInstancesToDeepIntelligence(table: DataSourceTable, instances: InstanceType[][]): Promise<void> {
        const url = (new URL("external/source/update", Config.getInstance().deepintURL)).toString();
        return new Promise<void>((resolve, reject) => {
            Request.post(
                url,
                {
                    headers: {
                        'x-public-key': table.publicKey,
                        'x-secret-key': table.secretKey,
                    },
                    json: instances,
                },
                (err, response, body) => {
                    if (err) {
                        return reject(err);
                    }
                    if (response.statusCode !== 200) {
                        return reject(new Error("Status code: " + response.statusCode));
                    }
                    resolve();
                },
            )
        });
    }

    public async runUpdateService() {
        const promises: Promise<any>[] = [];

        for (const table of this.tables) {
            promises.push(this.runUpdateServiceTable(table));
        }

        return Promise.all(promises);
    }

    public async runUpdateServiceTable(table: DataSourceTable) {
        while (!this.closed) {
            await table.updateSem.acquire();

            if (!table.requiredUpdate && table.updateQueue.length === 0) {
                continue;
            }

            const instancesToPush: InstanceType[][] = [];

            while (instancesToPush.length < DEEPINT_UPDATE_INSTANCES_LIMIT && table.updateQueue.length > 0) {
                instancesToPush.push(table.updateQueue.shift());
            }

            table.requiredUpdate = false;

            let done = false;

            while (!done) {
                try {
                    await this.sendInstancesToDeepIntelligence(table, instancesToPush);
                    done = true;
                } catch (ex) {
                    console.error(ex);
                }

                if (!done) {
                    // If failure, wait 5 seconds to retry
                    await new Promise((resolve) => {
                        setTimeout(resolve, 5000);
                    });
                }
            }

            if (Config.getInstance().logEvents) {
                console.log(`[${(new Date()).toISOString()}] [UPDATE] [${table.table}] External source updated.`);
            }
        }
    }

    public sanitizeFilter(json: any): QueryTree {
        if (!json) {
            return null;
        }
        return sanitizeQueryTree(json, 0);
    }

    public sanitizeProjection(table: DataSourceTable, projection: string): number[] {
        if (!projection) {
            return [];
        }

        return projection.split(",").map(a => {
            return parseInt(a, 10);
        }).filter(a => {
            if (isNaN(a) || a < 0) {
                return false;
            }
            return !!table.fields[a];
        });
    }

    public sanitizeInstances(table: DataSourceTable, instances: any[]): InstanceType[][] {
        if (!Array.isArray(instances)) {
            return [];
        }
        return instances.map(i => {
            const instance: InstanceType[] = [];
            let row = i;
            if (typeof i !== "object") {
                row = Object.create(null);
            }

            for (const feature of table.fields) {
                instance.push(turnInto(row[feature.name], feature.type));
            }

            return instance;
        });
    }


    private async pushInstance(table: DataSourceTable, instance: InstanceType[]): Promise<void> {
        let sentence = "INSERT INTO \"" + table + "\"(";
        const sqlKeys = [];
        const values = [];
        const qm = [];

        for (const field of table.fields) {
            sqlKeys.push("\"" + field.name + "\"");
            values.push(instance[field.index]);
            qm.push("?");
        }

        sentence += sqlKeys.join(",");

        sentence += ") VALUES (";

        sentence += qm.join(",");

        sentence += ")";

        return new Promise<void>(function (resolve, reject) {
            this.pool.query(toPostgresTemplate(sentence), values, function (error, results) {
                if (error) {
                    return reject(error);
                }
                table.updateQueue.push(instance)
                resolve();
            }.bind(this));
        }.bind(this));
    }

    /**
     * Adds instances to the collection
     * @param table Table to query
     * @param instances Instances
     */
    public async pushInstances(table: DataSourceTable, instances: InstanceType[][]): Promise<void> {
        for (const instance of instances) {
            await this.pushInstance(table, instance);
        }
    }

    /**
     * Notices a source update
     */
    public noticeUpdate(table: DataSourceTable) {
        table.requiredUpdate = true;
        table.updateSem.release();
    }

    /**
     * Counts instances
     * @param table Table to query
     * @param filter Filter to apply
     * @returns Instances count
     */
    public async countInstances(table: DataSourceTable, filter: QueryTree): Promise<number> {
        let sentence = "SELECT COUNT(*) AS \"count\" FROM \"" + table.table + "\"";
        const values = [];

        const cond1 = toSQLCondition(table.fields, filter);

        if (cond1.sql) {
            sentence += " WHERE " + cond1.sql;
            for (const v of cond1.params) {
                values.push(v);
            }
        }

        return new Promise<number>(function (resolve, reject) {
            this.pool.query(sentence, values, function (error, results) {
                if (error) {
                    return reject(error);
                }
                if (results.rows && results.rows.length > 0) {
                    resolve(parseInt(results.rows[0].count, 10) || 0);
                } else {
                    resolve(0);
                }
            }.bind(this));
        }.bind(this));
    }

    /**
     * Query instances
     * @param table Table to query
     * @param filter Filter to apply
     * @param order Feature to order by
     * @param dir Order direction
     * @param skip Instances to skip
     * @param limit Limit of instances to return
     * @param projection Projection to apply
     * @param onStart Called with the list of features
     * @param onRow Called for each row
     */
    public async query(table: DataSourceTable, filter: QueryTree, order: number, dir: string, skip: number, limit: number, projection: number[], onStart: (features: Feature[]) => void, onRow: (instance: InstanceType[]) => void): Promise<void> {
        let features = table.fields;

        let sentence = "SELECT ";
        const values = [];

        if (projection && projection.length > 0) {
            features = [];
            const proj = [];
            for (const f of projection) {
                if (table.fields[f]) {
                    proj.push('"' + table.fields[f].name + '"');

                    features.push(table.fields[f]);
                }
            }

            sentence += proj.join(", ");
        } else {
            sentence += "*";
        }

        sentence += " FROM \"" + table.table + "\"";

        const cond1 = toSQLCondition(table.fields, filter);

        if (cond1.sql) {
            sentence += " WHERE " + cond1.sql;
            for (const v of cond1.params) {
                values.push(v);
            }
        }

        if (order >= 0 && table.fields[order]) {
            sentence += " ORDER BY \"" + table.fields[order].name + "\" " + (dir === "desc" ? "DESC" : "ASC");
        }

        if (limit !== null && limit > 0) {
            sentence += " LIMIT " + limit;
        }

        if (skip !== null && skip > 0) {
            sentence += " OFFSET " + skip;
        }


        if (Config.getInstance().logDebug) {
            console.log("[QUERY] [PostgreSQL] " + sentence + "\nValues: " + JSON.stringify(values));
        }

        return new Promise<void>(async function (resolve, reject) {
            let client;

            try {
                client = await this.pool.connect();
            } catch (ex) {
                return reject(ex);
            }

            const cursor = client.query(new Cursor(sentence, values));

            onStart(features);

            let resultsEnded = false;
            while (!resultsEnded) {
                const partialResuls: any[] = await (new Promise<any[]>(function (resolve) {
                    cursor.read(CURSOR_READ_AMOUNT, (err, rows) => {
                        if (err) {
                            return resolve([]);
                        }
                        resolve(rows);
                    });
                }));

                if (partialResuls.length > 0) {
                    for (const row of partialResuls) {
                        const instance = [];
                        for (const feature of features) {
                            instance.push(turnInto(row[feature.name], feature.type));
                        }
                        onRow(instance);
                    }
                } else {
                    resultsEnded = true;
                }
            }

            resolve();

            cursor.close(() => {
                client.release();
            })
        }.bind(this));
    }

    /**
     * Get nominal values
     * @param table Table to query
     * @param filter Filter to apply
     * @param query Text query for the field
     * @param feature Nominal feature
     * @returns List of nominal values
     */
    public async getNominalValues(table: DataSourceTable, filter: QueryTree, query: string, feature: number): Promise<string[]> {
        if (!table.fields[feature] || table.fields[feature].type !== 'nominal') {
            return [];
        }

        let sentence = "SELECT DISTINCT ";
        const values = [];

        const cond1 = toSQLCondition(table.fields, filter);
        const fieldName = table.fields[feature].name;
        query = (query || "").toLowerCase();

        sentence += '"' + fieldName + '" FROM "' + table.table + '"';

        if (cond1.sql) {
            if (query) {
                sentence += " WHERE (" + cond1.sql + ") AND \"" + fieldName + "\" LIKE ?";
                for (const v of cond1.params) {
                    values.push(v);
                }
                values.push("" + replaceWildcards(query) + "%");
            } else {
                sentence += " WHERE " + cond1.sql;
                for (const v of cond1.params) {
                    values.push(v);
                }
            }
        } else if (query) {
            sentence += " WHERE \"" + fieldName + "\" LIKE ?";
            values.push("" + replaceWildcards(query) + "%");
        }

        sentence += " ORDER BY \"" + fieldName + "\" ";

        sentence += " LIMIT 128";

        if (Config.getInstance().logDebug) {
            console.log("[QUERY] [PostgreSQL] " + sentence + "\nValues: " + JSON.stringify(values));
        }

        return new Promise<any[]>(function (resolve, reject) {
            this.pool.query(sentence, values, function (error, results) {
                if (error) {
                    return reject(error);
                }
                if (results.rows && results.rows.length > 0) {
                    resolve(results.rows.map(r => {
                        return r[fieldName];
                    }));
                } else {
                    resolve([]);
                }
            }.bind(this));
        }.bind(this));
    }
}

