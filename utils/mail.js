'use strict';
const _ = require('underscore'),
  mailer = require('nodemailer'),
  tpl = require('./mail-template');
  
const email_url = process.env.MAIL_URL
// create reusable transporter object using the default SMTP transport 
const transporter = mailer.createTransport(email_url);

// setup e-mail data with unicode symbols 
let mailOptions = {
  from: '"Bitunnel Team 👥" <no-reply@bitunnel.io>', // sender address 
  subject: 'Bitunnel Error Notification ✔', // Subject line 
};

exports.sendMail = (users, message) => {
  return new Promise((res, rej) => {
    let userMails = _.map(users, user => {
      return user.email;
    })
    userMails = userMails.toString();

    message = _.extend(message, {time: new Date().toISOString()});

    mailOptions = _.extend(mailOptions, { to: userMails });
    mailOptions = _.extend(mailOptions, { html: tpl.htmlTemplate(message) });
    mailOptions = _.extend(mailOptions, { text: tpl.textTemplate(message) }); // plaintext body

    // send mail with defined transport object 
    transporter.sendMail(mailOptions, function(error, info) {
      if (error) {
        rej(error);
      }
      res(info);
    });
  });
}
