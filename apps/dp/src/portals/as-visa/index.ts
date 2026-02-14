import { registerPortal, registerFSMHandlers } from '../registry.js';
import { asVisaDriver } from './driver.js';
import { asVisaHandlers } from './fsm/handlers.js';
import { PORTAL_ID } from './config.js';

registerPortal(asVisaDriver);
registerFSMHandlers(PORTAL_ID, asVisaHandlers);