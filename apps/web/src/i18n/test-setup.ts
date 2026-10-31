import { i18n } from '@lingui/core';

import { SOURCE_LOCALE } from './locales.js';

/**
 * Vitest's setup for every test file: English, from the messages in the
 * source, as the page has before anything else runs. A test that wants
 * another language activates it itself.
 */
i18n.loadAndActivate({ locale: SOURCE_LOCALE, messages: {} });
