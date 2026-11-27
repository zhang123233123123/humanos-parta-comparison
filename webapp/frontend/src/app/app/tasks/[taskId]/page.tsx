import { redirect } from 'next/navigation'
export default function TaskPage({ params }: { params: { taskId: string } }) { redirect('/app?task=' + encodeURIComponent(params.taskId)) }
