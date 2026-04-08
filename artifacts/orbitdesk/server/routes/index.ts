import { Router } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import usersRouter from "./users.js";
import ticketsRouter from "./tickets.js";
import departmentsRouter from "./departments.js";
import dashboardRouter from "./dashboard.js";
import emailRouter from "./email.js";
import permissionsRouter from "./permissions.js";
import settingsRouter from "./settings.js";
import publicRequestRouter from "./publicRequest.js";
import attachmentsRouter from "./attachments.js";

const router = Router();

router.use(healthRouter);
router.use(publicRequestRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(ticketsRouter);
router.use(departmentsRouter);
router.use(dashboardRouter);
router.use(emailRouter);
router.use(permissionsRouter);
router.use(settingsRouter);
router.use(attachmentsRouter);

export default router;
