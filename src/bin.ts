#!/usr/bin/env node
import { runProcess } from "./composition/main.js";

process.exitCode = await runProcess();
