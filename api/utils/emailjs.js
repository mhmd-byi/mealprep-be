require('dotenv');
const emailjs = require('@emailjs/nodejs');

const initEmailer = () => {
    emailjs.init({
        publicKey: process.env.EMAILJS_PUBLIC_KEY,
    });
}

const sendEmail = (email, name, link) => {
    const templateParams = {
        name : name,
        link: link,
    }
    emailjs.send(process.env.EMAILJS_SERVICE_ID, process.env.EMAILJS_TEMPLATE_ID, templateParams, {
        publicKey: process.env.EMAILJS_PUBLIC_KEY,
        privateKey: process.env.EMAILJS_PRIVATE_KEY,
    }).then((response) => {
        console.log('SUCCESS!', response.status, response.text);
    }).catch((error) => {
        console.log('FAILED...', error);
    })
}

module.exports = {
    sendEmail
}