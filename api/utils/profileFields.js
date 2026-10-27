const ProfessionOption = require('../models/professionOptionModel');

const PROFILE_FIELD_KEYS = ['gender', 'genderOther', 'profession', 'professionOther'];
const GENDERS = ['male', 'female', 'other'];
const OTHER_PROFESSION = 'Other';
const GENDER_OTHER_MAX = 40;
const PROFESSION_OTHER_MAX = 60;

const trimTo = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const pickProfileFields = (source = {}) =>
  Object.fromEntries(PROFILE_FIELD_KEYS.map((key) => [key, source[key] ?? '']));

const pickSubmittedProfileFields = (body = {}) =>
  Object.fromEntries(PROFILE_FIELD_KEYS.filter((key) => key in body).map((key) => [key, body[key]]));

const cleanProfileFields = async (input = {}, current = {}) => {
  const gender = GENDERS.includes(input.gender) ? input.gender : '';
  const genderOther = gender === 'other' ? trimTo(input.genderOther, GENDER_OTHER_MAX) : '';
  if (gender === 'other' && !genderOther) {
    return { error: 'Please type your gender in the box.' };
  }

  const options = await ProfessionOption.find({}, 'label').lean();
  const validProfessions = [OTHER_PROFESSION, current.profession, ...options.map((option) => option.label)].filter(Boolean);
  const profession = validProfessions.includes(input.profession) ? input.profession : '';
  const professionOther = profession === OTHER_PROFESSION ? trimTo(input.professionOther, PROFESSION_OTHER_MAX) : '';
  if (profession === OTHER_PROFESSION && !professionOther) {
    return { error: 'Please type your profession in the box.' };
  }

  return { value: { gender, genderOther, profession, professionOther } };
};

module.exports = {
  OTHER_PROFESSION,
  PROFILE_FIELD_KEYS,
  pickProfileFields,
  pickSubmittedProfileFields,
  cleanProfileFields
};
