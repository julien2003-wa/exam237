export type ClassItem = { code:string; label:string; examType:string; series:string|null; groupId:string|null; groupLabel:string|null };
export type GroupItem = { id:string; code:string; label:string; examType:string; active:boolean };
export type PaperItem = {
  id:string; classCode:string; classLabel:string; year:number; session:string; title:string;
  subjectId:string; subjectName:string; paperUrl:string|null; locked:boolean;
  corrections:Array<{id:string;title:string;pdfUrl:string|null;videoUrl:string|null}>;
};
export type StudentItem = {
  id:string; email:string; displayName:string; classCode:string|null; classLabel:string|null;
  groupLabel:string|null; accountStatus:'pending'|'active'|'expired'|'suspended'; premiumUntil:string|null;
  online:boolean; lastSeenAt:string|null;
};
