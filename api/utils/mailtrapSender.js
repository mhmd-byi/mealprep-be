// Looking to send emails in production? Check out our Email API/SMTP product!
const sendEmailMailTrap = async (req, res) => {
  try {
    const { to, subject, text } = req.body;
    
    const options = {
      method: "POST",
      url: "https://send.api.mailtrap.io/api/send",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Api-Token": process.env.MAILTRAP_API_TOKEN,
      },
      data: {
        to: [to],
        from: { email: 'info@mealprep.co.in', name: 'Mealprep Info' },
        headers: {'X-Message-Source': 'app.mealprep.co.in'},
        subject: subject,
        text: text,
      }
    };

    const response = await axios.request(options);
    res.json(response.data);
  } catch (error) {
    console.error('Email sending failed:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
};

module.exports = {
  sendEmailMailTrap,
};

