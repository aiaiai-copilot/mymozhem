-- AddForeignKey
ALTER TABLE "room"."Room" ADD CONSTRAINT "Room_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "identity"."Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
