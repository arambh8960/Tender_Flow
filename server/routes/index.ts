import { Router } from 'express';
import authRoutes from './auth.routes';
import discoveryRoutes from './discovery.routes';
import rfpRoutes from './rfp.routes';
import vaultRoutes from './vault.routes';
import organizationRoutes from './organization.routes';
import organizationAccountRoutes from './organizationAccount.routes';
import organizationConfigRoutes from './organizationConfig.routes';
import adminRoutes from './admin.routes';
import aiRoutes from './ai.routes';

const router = Router();

router.use(authRoutes);
router.use(discoveryRoutes);
router.use(rfpRoutes);
router.use(vaultRoutes);
router.use(organizationAccountRoutes);
router.use(organizationConfigRoutes);
router.use(organizationRoutes);
router.use(adminRoutes);
router.use(aiRoutes);

export default router;
