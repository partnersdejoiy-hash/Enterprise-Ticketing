import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import ticketsRouter from "./tickets";
import departmentsRouter from "./departments";
import dashboardRouter from "./dashboard";
import emailRouter from "./email";
import permissionsRouter from "./permissions";
import settingsRouter from "./settings";
import automationRulesRouter from "./automationRules";
import publicRequestRouter from "./publicRequest";
import attachmentsRouter from "./attachments";
import emailAccountsRouter from "./emailAccounts";
import webhooksRouter from "./webhooks";

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
router.use(automationRulesRouter);
router.use(publicRequestRouter);
router.use(attachmentsRouter);
router.use(emailAccountsRouter);
router.use("/webhooks", webhooksRouter);

export default router;
