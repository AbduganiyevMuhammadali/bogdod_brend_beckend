'use strict';

// Standart "Admin" foydalanuvchisining oson (123456) parolini kuchliroq
// standart parolga almashtiradi. Faqat username='Admin' qatoriga tegadi.
const NEW_HASH = '$2a$08$c8VNa6iCA8D2eDAZWSSC3uGkl3Gs5obD8uOoFuoqDKRj34LFf2wAG';
const OLD_HASH = '$2a$08$YLZ7gtHc5KgiF3TlX/12r.boof4dIvGSoViUYxaRL8f7yHhKjPh0i';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      'UPDATE user SET password = :newHash WHERE username = :username AND password = :oldHash',
      {
        replacements: { newHash: NEW_HASH, username: 'Admin', oldHash: OLD_HASH },
        type: Sequelize.QueryTypes.UPDATE,
      }
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      'UPDATE user SET password = :oldHash WHERE username = :username AND password = :newHash',
      {
        replacements: { newHash: NEW_HASH, username: 'Admin', oldHash: OLD_HASH },
        type: Sequelize.QueryTypes.UPDATE,
      }
    );
  }
};
