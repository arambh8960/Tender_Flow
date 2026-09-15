import { Router } from 'express';
import {
  addDocument,
  listDocuments,
  replaceDocument,
  getDocumentLink,
  archiveDocument,
  addDocumentSchema,
  replaceDocumentSchema,
} from '../controllers/vault.controller';
import { uploadToMemory } from '../services/documents/documentStorage';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, requireOrgMember } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { uploadLimiter } from '../middleware/rateLimit';

const router = Router();

// multer runs before validation so the multipart fields are present on
// req.body by the time the schema sees them.
router.post(
  '/vault/documents',
  asyncHandler(requireAuth),
  uploadLimiter,
  uploadToMemory.single('file'),
  validate(addDocumentSchema),
  asyncHandler(requireOrgMember('manager')),
  asyncHandler(addDocument)
);

router.get(
  '/vault/documents',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('viewer')),
  asyncHandler(listDocuments)
);

router.post(
  '/vault/documents/replace',
  asyncHandler(requireAuth),
  uploadLimiter,
  uploadToMemory.single('file'),
  validate(replaceDocumentSchema),
  asyncHandler(requireOrgMember('manager')),
  asyncHandler(replaceDocument)
);

// Returns a short-lived signed URL rather than streaming a file off disk.
router.get(
  '/vault/documents/:documentId/link',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('viewer')),
  asyncHandler(getDocumentLink)
);

router.delete(
  '/vault/documents/:documentId',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('manager')),
  asyncHandler(archiveDocument)
);

export default router;
