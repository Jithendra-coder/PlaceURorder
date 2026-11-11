import { api } from "@/services/api";
import { auth as sessionAuth } from "@/lib/auth";
import { DEV_DEMO_EMAIL, DEV_DEMO_USER_ID, activateDevDemoSession, isDevDemoCredentials } from "@/lib/dev-demo";

export type AuthUser = {
  id: string;
  email: string;
  full_name?: string | null;
  onboardingComplete: boolean;
};

function withOnboarding(user: Omit<AuthUser, "onboardingComplete">, complete: boolean): AuthUser {
  return { ...user, onboardingComplete: complete };
}

export const AuthService = {
  async signIn(identifier: string, password: string): Promise<{ user: AuthUser; nextRoute: string }> {
    if (isDevDemoCredentials(identifier, password)) {
      activateDevDemoSession();
      const demoStatus = await api.onboardingStatus();
      const demoUser = { id: DEV_DEMO_USER_ID, email: DEV_DEMO_EMAIL, full_name: "Demo Owner", is_active: true };
      sessionAuth.setUser(demoUser);
      return { user: withOnboarding(demoUser, demoStatus.onboarding_completed), nextRoute: demoStatus.next_route };
    }
    const session = await api.login(identifier, password);
    const status = await api.onboardingStatus();
    return { user: withOnboarding(session.user, status.onboarding_completed), nextRoute: status.next_route };
  },

  startGoogleSignIn() {
    return api.startGoogleOAuth();
  },

  completeGoogleSignIn(code: string) {
    return api.exchangeGoogleOAuth(code);
  },

  signUp(email: string, password: string) {
    return api.signup(email, password);
  },

  startSignUp(email: string) {
    return api.startSignup(email);
  },

  acceptSignupLink(accessToken: string, refreshToken: string) {
    return api.acceptSignupLink(accessToken, refreshToken);
  },

  verifySignUp(email: string, code: string) {
    return api.verifySignup(email, code);
  },

  completeSignUp(password: string) {
    return api.completeSignup(password);
  },

  async verifyOtp(email: string, code: string): Promise<AuthUser> {
    const session = await api.verifyEmail(email, code);
    const status = await api.onboardingStatus();
    return withOnboarding(session.user, status.onboarding_completed);
  },

  sendOtp(email: string) {
    return api.resendVerification(email);
  },

  forgotPassword(email: string) {
    return api.forgotPassword(email);
  },

  resetPassword(token: string, password: string) {
    return api.resetPassword(token, password);
  },
};
