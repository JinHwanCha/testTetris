# Supabase Authentication Setup Guide

This guide will walk you through setting up Google OAuth and Email/Password authentication for your Drop the Cube game.

## Prerequisites

- Supabase project already created
- Database schema already set up (see `SUPABASE_SETUP.md`)
- Google Cloud Console account

---

## Step 1: Run Database Migration

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Open `supabase-schema.sql` file
4. **Run only the migration section** at the bottom of the file:
   - The section starts with `-- MIGRATION: Add Authentication Support`
   - This adds `user_id` and `display_name` columns to the rankings table
   - Updates RLS policies for authenticated users

5. Verify the migration:
   ```sql
   SELECT column_name, data_type
   FROM information_schema.columns
   WHERE table_name = 'rankings';
   ```
   You should see `user_id` and `display_name` in the results.

---

## Step 2: Enable Email/Password Authentication

Email authentication is **enabled by default** in Supabase. Verify it:

1. Go to **Authentication** → **Providers**
2. Find **Email** provider
3. Ensure it's toggled **ON** (should be green)
4. (Optional) Customize email templates under **Email Templates**

**Note:** Users will need to confirm their email address before they can log in. Make sure your SMTP settings are configured in **Authentication** → **Settings** → **SMTP Settings**.

---

## Step 3: Set Up Google OAuth

### 3.1 Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project or create a new one
3. Enable **Google+ API**:
   - Go to **APIs & Services** → **Library**
   - Search for "Google+ API"
   - Click **Enable**

4. Create OAuth 2.0 Credentials:
   - Go to **APIs & Services** → **Credentials**
   - Click **+ CREATE CREDENTIALS** → **OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Name: "Drop the Cube" (or any name you prefer)

5. Add Authorized redirect URIs:
   - Find your Supabase project URL (e.g., `https://your-project.supabase.co`)
   - Add this redirect URI:
     ```
     https://your-project.supabase.co/auth/v1/callback
     ```
   - Replace `your-project` with your actual Supabase project reference ID

6. Click **CREATE**
7. **Copy** the Client ID and Client Secret (you'll need these next)

### 3.2 Configure Google Provider in Supabase

1. Go to your Supabase project dashboard
2. Navigate to **Authentication** → **Providers**
3. Find **Google** provider
4. Click to expand it
5. Toggle **Enable Sign in with Google** to ON
6. Paste your **Client ID** and **Client Secret** from Google Cloud Console
7. Click **Save**

---

## Step 4: Configure Site URLs

1. Go to **Authentication** → **URL Configuration**
2. Set **Site URL** to your production URL:
   - Example: `https://yourdomain.com`
   - For local development: `http://localhost:5173`

3. Add **Redirect URLs** (one per line):
   ```
   https://yourdomain.com
   http://localhost:5173
   ```

4. Click **Save**

**Important:** Make sure your production domain is added to redirect URLs before deploying.

---

## Step 5: Test Authentication

### Test Email/Password Signup

1. Run your development server:
   ```bash
   npm run dev
   ```

2. Open the game in your browser
3. Click **Login** button in the top bar
4. Switch to **Sign Up** tab
5. Enter a test email and password (min 6 characters)
6. Click **Sign Up**
7. Check your email for confirmation link
8. Click the confirmation link
9. Return to the game and log in with your credentials

### Test Google OAuth

1. Click **Login** button
2. Click **Continue with Google**
3. Select your Google account
4. Grant permissions
5. You should be redirected back to the game and logged in
6. Your name and avatar from Google should appear in the top bar

### Test Guest Mode

1. Log out if you're logged in
2. Play a game without logging in
3. When game ends, auth modal should appear
4. Click **Continue as Guest** to dismiss without submitting score

### Test Ranking Submission

1. Log in with Google or Email
2. Play a game and let it end
3. Your score should be automatically submitted to the leaderboard
4. Your display name from Google/Email should appear in the rankings

---

## Step 6: Verify Database

Check that authenticated rankings are being saved correctly:

1. Go to **Table Editor** → **rankings**
2. Look for recent entries
3. Verify that:
   - `user_id` is populated (UUID format)
   - `display_name` contains the user's name
   - `name` also contains the user's name (fallback)

---

## Troubleshooting

### Google OAuth redirect loop

**Problem:** After clicking Google login, the page keeps redirecting

**Solution:**
- Verify your redirect URI in Google Cloud Console exactly matches:
  ```
  https://your-project.supabase.co/auth/v1/callback
  ```
- Check Site URL in Supabase matches your current domain

### Email confirmation not sent

**Problem:** Users don't receive confirmation email

**Solution:**
- Check **Authentication** → **Settings** → **SMTP Settings**
- Verify your email service is configured correctly
- For development, you can disable email confirmation:
  - Go to **Authentication** → **Settings**
  - Toggle OFF "Enable email confirmations"
  - **Not recommended for production**

### Rankings not showing user names

**Problem:** Authenticated rankings show NULL or missing names

**Solution:**
- Check that `display_name` column exists in database
- Verify Google OAuth is returning user metadata
- Check browser console for errors

### Session lost on page refresh

**Problem:** User logged out after refreshing page

**Solution:**
- Clear browser cache and cookies
- Check browser storage for `supabase.auth.token`
- Verify `initAuth()` is calling `getSession()` in code

### RLS policy blocking inserts

**Problem:** Can't submit rankings even when logged in

**Solution:**
- Check RLS policies in **Table Editor** → **rankings** → **Policies**
- Verify "Enable insert for authenticated users" policy exists
- Test query in SQL Editor:
  ```sql
  SELECT * FROM auth.users WHERE id = auth.uid();
  ```

---

## Security Best Practices

1. **Never expose API keys:**
   - Keep `.env` file private
   - Don't commit `.env` to Git
   - Use environment variables in production

2. **Enable RLS:**
   - Row Level Security is already enabled
   - Users can only update/delete their own rankings

3. **Rate limiting:**
   - Supabase has built-in rate limiting
   - Monitor usage in **Reports** → **API**

4. **Email verification:**
   - Keep email confirmation enabled in production
   - Prevents spam accounts

---

## Production Deployment Checklist

Before deploying to production:

- [ ] Google OAuth redirect URI includes production domain
- [ ] Site URL in Supabase set to production domain
- [ ] Redirect URLs include production domain
- [ ] Environment variables configured in hosting platform
- [ ] Email SMTP properly configured
- [ ] Email confirmation enabled
- [ ] Test login flow on production domain
- [ ] Test ranking submission on production domain
- [ ] Monitor Supabase logs for errors

---

## Next Steps

Once authentication is working:

1. **Test thoroughly:**
   - Test on multiple browsers
   - Test on mobile devices
   - Test with different Google accounts
   - Test email signup with different email providers

2. **Monitor usage:**
   - Check **Authentication** → **Users** for user signups
   - Check **Table Editor** → **rankings** for submissions
   - Review **Reports** for API usage

3. **Consider enhancements:**
   - Add user profile page
   - Add social features (friends, achievements)
   - Add email notifications
   - Add more OAuth providers (Facebook, Twitter, Apple)

---

## Support

If you encounter issues not covered in this guide:

1. Check Supabase documentation: https://supabase.com/docs/guides/auth
2. Check Google OAuth documentation: https://developers.google.com/identity/protocols/oauth2
3. Review browser console for error messages
4. Check Supabase logs in **Logs** → **API Logs**

---

## Summary

You have successfully set up:
- ✅ Google OAuth authentication
- ✅ Email/Password authentication
- ✅ User rankings with authentication
- ✅ Optional guest play mode
- ✅ Secure database with RLS policies

Users can now:
- Play as guests without logging in
- Sign up with email or Google
- Submit scores to the leaderboard (login required)
- See their name and avatar in the game

Enjoy your authenticated Drop the Cube game! 🎮
