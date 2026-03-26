import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/authcomponents/ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col font-sans" style={{ fontFamily: 'Inter, Arial, sans-serif' }}>
      {/* LOGO top left */}
      <div className="absolute left-0 top-0 p-8 text-2xl font-extrabold tracking-tight text-black" style={{ fontFamily: 'Inter, Arial, sans-serif' }}>
        LOGO
      </div>
      <div className="flex-1 flex items-center justify-center">
        <Card className="w-full max-w-lg shadow-none border-none bg-transparent min-h-[650px] flex flex-col justify-center">
          <CardHeader className="text-center pb-2">
            <CardTitle
              className="text-5xl md:text-6xl font-extrabold mb-8"
              style={{ color: '#232323', fontFamily: 'Inter, Arial, sans-serif', fontWeight: 800 }}
            >
              Reset Password
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col justify-center">
            <ResetPasswordForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}