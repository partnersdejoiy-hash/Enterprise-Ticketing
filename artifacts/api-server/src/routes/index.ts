import { Router, type IRouter } from "express";
import healthRouter from "./health.ts";
import authRouter from "./auth.ts";
import usersRouter from "./users.ts";
import ticketsRouter from "./tickets.ts";
import departmentsRouter from "./departments.ts";
import dashboardRouter from "./dashboard.ts";
import emailRouter from "./email.ts";
import permissionsRouter from "./permissions.ts";
import settingsRouter from "./settings.ts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(ticketsRouter);
router.use(departmentsRouter);
router.use(dashboardRouter);
router.use(emailRouter);
router.use(permissionsRouter);
router.use(settingsRouter);

export default router;
