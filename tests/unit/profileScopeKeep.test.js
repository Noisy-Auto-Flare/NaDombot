jest.mock('../../src/utils/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/utils/userProfile', () => ({
  getAvailableClasses: jest.fn(),
  getAvailableTracks: jest.fn(),
  getAvailableSubgroups: jest.fn(),
  setUserProfile: jest.fn(),
  getUserProfile: jest.fn()
}));
jest.mock('../../src/models', () => ({
  Track: { findByPk: jest.fn() },
  Subgroup: { findByPk: jest.fn() }
}));

const selectProfileScene = require('../../src/scenes/selectProfileScene');
const { setUserProfile } = require('../../src/utils/userProfile');

function makeCtx(data, state) {
  return {
    from: { id: 123 },
    callbackQuery: { data, },
    answerCbQuery: async () => {},
    editMessageReplyMarkup: async () => {},
    reply: async () => {},
    scene: { leave: async () => {}, state: {} },
    wizard: { state, next: async () => {}, selectStep: jest.fn(), cursor: 3 }
  };
}

describe('FIX-B scope не слетает при edit-сохранениях', () => {
  beforeEach(() => jest.clearAllMocks());

  test('профиль scope=all + смена учителя → scope остался all', async () => {
    const ctx = makeCtx('select_subgroup:newSub', {
      editMode: 'subgroup',
      originalProfile: { classId: '10a', trackId: null, subgroupId: 'oldSub', scope: 'all' }
    });
    // step 3 — обработчик выбора трека/подгруппы
    await selectProfileScene.steps[3](ctx);
    expect(setUserProfile).toHaveBeenCalledWith(
      123,
      expect.objectContaining({ classId: '10a', subgroupId: 'newSub', scope: 'all' })
    );
  });

  test('профиль scope=all + смена трека → scope остался all', async () => {
    const ctx = makeCtx('select_track:newTrack', {
      editMode: 'track',
      classId: '10a',
      originalProfile: { classId: '10a', trackId: 'oldTrack', subgroupId: 'sub1', scope: 'all' }
    });
    await selectProfileScene.steps[3](ctx);
    expect(setUserProfile).toHaveBeenCalledWith(
      123,
      expect.objectContaining({ trackId: 'newTrack', scope: 'all' })
    );
  });
});
