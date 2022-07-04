// MQTT controller

import MQTT from "mqtt";
import { Config } from "./config";
import { DataSource } from "./source";

export class RealTimeController {
    public static instance: RealTimeController;

    public static getInstance() {
        if (RealTimeController.instance) {
            return RealTimeController.instance;
        }

        RealTimeController.instance = new RealTimeController();

        return RealTimeController.instance;
    }

    public client: MQTT.Client;
    public topics: string[];

    constructor() {
        this.topics = Config.getInstance().tablesConfig.map(t => {
            return t.topic;
        }).filter(t => {
            return !!t;
        });
        this.client = MQTT.connect(Config.getInstance().mqttURL, {
            username: Config.getInstance().mqttUser,
            password: Config.getInstance().mqttPassword,
            reconnectPeriod: 1000,
        });

        this.client.on("connect", this.onConnect.bind(this));
        this.client.on("error", this.onError.bind(this));
        this.client.on("close", this.onError.bind(this));
        this.client.on("message", this.onMessage.bind(this));
    }

    public async onError(err) {
        if (err) {
            if (Config.getInstance().logEvents) {
                console.log(`[${(new Date()).toISOString()}] [MQTT] Connection error: ${err.message}.`);
            }
        } else {
            if (Config.getInstance().logEvents) {
                console.log(`[${(new Date()).toISOString()}] [MQTT] Connection closed.`);
            }
        }
    }

    public async onConnect() {
        if (Config.getInstance().logEvents) {
            console.log(`[${(new Date()).toISOString()}] [MQTT] Connected to ${Config.getInstance().mqttURL}`);
        }

        for (const topic of this.topics) {
            this.client.subscribe(topic, err => {
                if (err) {
                    if (Config.getInstance().logEvents) {
                        console.log(`[${(new Date()).toISOString()}] [MQTT] Error (Subscribe): ${err.message}`);
                    }
                } else {
                    if (Config.getInstance().logEvents) {
                        console.log(`[${(new Date()).toISOString()}] [MQTT] Subscribed to ${topic}`);
                    }
                }
            });
        }
    }

    public async onMessage(topic: string, message: Buffer) {
        const msgStr = message.toString();

        if (Config.getInstance().logDebug) {
            console.log(`[${(new Date()).toISOString()}] [MQTT] Topic: ${topic},  Message ${msgStr}`);
        }

        let msgJson;

        try {
            msgJson = JSON.parse(msgStr);
        } catch (ex) {
            if (Config.getInstance().logEvents) {
                console.log(`[${(new Date()).toISOString()}] [MQTT] Error: Invalid message | Topic: ${topic},  Message ${msgStr}`);
            }
            return;
        }

        const table = DataSource.getInstance().getTableFromTopic(topic);

        if (!table) {
            return;
        }

        const instances = DataSource.getInstance().sanitizeInstances(table, [msgJson]);

        await DataSource.getInstance().pushInstances(table, instances);
    }
}
