// Controller

"use strict";

import Express from "express";
import { DataSource, DataSourceTable } from "./source";

export class Controller {
    public register(application: Express.Express) {
        throw new Error("Controller not implemented yet. Override the register method.");
    }

    public checkAuth(request: Express.Request): DataSourceTable {
        const pubKey = request.headers["x-public-key"] + "";
        const secretKey = request.headers["x-secret-key"] + "";

        return DataSource.getInstance().getTableFromCredentials(pubKey, secretKey);
    }
}
