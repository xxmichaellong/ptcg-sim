import { systemState } from '../../front-end.js';
import { acceptAction } from './accept-action.js';

export const catchUpActions = (actionData) => {
  const missingData = actionData.slice(systemState.oppCounter); // make sure you are only implementing actions that you don't have

  missingData.forEach((entry) => {
    systemState.oppCounter++;
    if (entry.parameters[0] === 'self') {
      entry.parameters[0] = 'opp';
    } else if (entry.parameters[0] === 'opp') {
      entry.parameters[0] = 'self';
    }
    // systemState.spectatorActionData.push({user: 'opp', action: entry.action, parameters: entry.parameters});
    if (entry.action !== 'exchangeData' && entry.action !== 'loadDeckData') {
      systemState.exportActionData.push({
        user: 'opp',
        emit: true,
        action: entry.action,
        parameters: entry.parameters,
      });
    }
  });

  const mostRecentDeckDataIndex = [...missingData]
    .reverse()
    .findIndex(
      (entry) =>
        entry.action === 'exchangeData' || entry.action === 'loadDeckData'
    );

  const mostRecentResetEntryIndex = [...missingData]
    .reverse()
    .findIndex((entry) => entry.action === 'reset' || entry.action === 'setup');

  // Retrieve all entries starting from the most recent reset/setup entry
  const mostRecentResetAndAfterEntries =
    mostRecentResetEntryIndex !== -1
      ? missingData.slice(missingData.length - mostRecentResetEntryIndex - 1)
      : 0;

  const mostRecentDeckDataEntry =
    mostRecentDeckDataIndex !== -1
      ? missingData[missingData.length - mostRecentDeckDataIndex - 1]
      : 0;

  const entriesAfterMostRecentDeckData =
    mostRecentDeckDataIndex !== -1
      ? missingData.slice(missingData.length - mostRecentDeckDataIndex)
      : 0;

  if (mostRecentDeckDataEntry) {
    acceptAction(
      'opp',
      mostRecentDeckDataEntry.action,
      mostRecentDeckDataEntry.parameters
    );
  }
  if (
    mostRecentResetAndAfterEntries &&
    mostRecentResetEntryIndex < mostRecentDeckDataIndex
  ) {
    mostRecentResetAndAfterEntries.forEach((data) =>
      acceptAction('opp', data.action, data.parameters)
    );
  } else if (mostRecentDeckDataEntry) {
    entriesAfterMostRecentDeckData.forEach((data) =>
      acceptAction('opp', data.action, data.parameters)
    );
  } else {
    missingData.forEach((data) =>
      acceptAction('opp', data.action, data.parameters)
    );
  }
};
