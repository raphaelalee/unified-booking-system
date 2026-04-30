const { OpenAI } = require('openai');
require('dotenv').config();

// Initialize Groq using the OpenAI SDK
const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1" // This redirects requests to Groq
});

exports.getBeautyAdvice = async (req, res) => {
    try {
        const { userQuery, message } = req.body;
        const prompt = String(userQuery || message || '').trim();

        if (!process.env.GROQ_API_KEY) {
            return res.status(500).json({
                success: false,
                message: "AI is not configured yet."
            });
        }

        if (!prompt) {
            return res.status(400).json({
                success: false,
                message: "Please enter a question."
            });
        }

        const completion = await groq.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: "You are a professional Beauty & Wellness consultant for Vaniday Singapore. Suggest relevant services, products, and booking options from categories such as hair, nails, facial, massage, spa, gym, skincare, and wellness. Keep answers friendly, practical, and concise. Do not give medical diagnosis." 
                },
                { role: "user", content: prompt }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.7,
            max_completion_tokens: 350
        });

        const aiResponse = completion.choices?.[0]?.message?.content || "Sorry, I could not generate an answer just now.";
        res.json({ success: true, answer: aiResponse });

    } catch (error) {
        console.error("Groq API Error:", error);
        res.status(500).json({ success: false, message: "AI is currently resting!" });
    }
};
